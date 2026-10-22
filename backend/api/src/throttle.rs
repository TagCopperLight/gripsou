//! In-memory login throttle: slows password guessing per account and per IP,
//! never locks anyone out. gripsou runs as one instance, so a restart clearing
//! the counters is acceptable (an attacker can't trigger one).

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

const WINDOW: Duration = Duration::from_secs(15 * 60);
const ACCOUNT_FREE_FAILURES: u32 = 5;
const ACCOUNT_FIRST_WAIT: Duration = Duration::from_secs(60);
const MAX_WAIT: Duration = Duration::from_secs(15 * 60);
const IP_MAX_FAILURES: u32 = 30;
/// Above this many keys, stale entries are dropped on the next failure.
const PRUNE_ABOVE: usize = 10_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reason {
    Account,
    Ip,
}

impl Reason {
    pub fn as_str(self) -> &'static str {
        match self {
            Reason::Account => "account",
            Reason::Ip => "ip",
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct Blocked {
    pub retry_after: Duration,
    pub reason: Reason,
    /// True only for the first refusal since this key's current wait began,
    /// so a flood of refused requests logs one line, not one each.
    pub first_refusal: bool,
}

impl Blocked {
    /// Whole seconds for the `Retry-After` header, rounded up, at least 1.
    pub fn retry_after_secs(&self) -> u64 {
        let d = self.retry_after;
        (d.as_secs() + u64::from(d.subsec_nanos() > 0)).max(1)
    }
}

#[derive(Default)]
struct Entry {
    failures: u32,
    last_failure: Option<Instant>,
    blocked_until: Option<Instant>,
    /// Whether the current wait has already refused an attempt.
    refused: bool,
}

impl Entry {
    fn blocked_for(&self, now: Instant) -> Option<Duration> {
        self.blocked_until
            .map(|until| until.saturating_duration_since(now))
            .filter(|d| !d.is_zero())
    }

    /// Refuse the attempt if this key is waiting.
    fn refuse(&mut self, now: Instant, reason: Reason) -> Option<Blocked> {
        let retry_after = self.blocked_for(now)?;
        let first_refusal = !self.refused;
        self.refused = true;
        Some(Blocked {
            retry_after,
            reason,
            first_refusal,
        })
    }

    fn block(&mut self, now: Instant, wait: Duration) {
        self.blocked_until = Some(now + wait);
        self.refused = false;
    }

    /// Count one failure, forgetting earlier ones outside the window.
    fn fail(&mut self, now: Instant) -> u32 {
        if self
            .last_failure
            .is_some_and(|t| now.saturating_duration_since(t) > WINDOW)
        {
            self.failures = 0;
        }
        self.failures += 1;
        self.last_failure = Some(now);
        self.failures
    }

    fn stale(&self, now: Instant) -> bool {
        self.blocked_for(now).is_none()
            && self
                .last_failure
                .is_none_or(|t| now.saturating_duration_since(t) > WINDOW)
    }
}

#[derive(Default)]
pub struct LoginThrottle {
    accounts: Mutex<HashMap<String, Entry>>,
    ips: Mutex<HashMap<String, Entry>>,
}

fn account_key(email: &str) -> String {
    email.trim().to_lowercase()
}

/// A panic while holding the lock leaves plain counters behind: still usable.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn prune(map: &mut HashMap<String, Entry>, now: Instant) {
    if map.len() > PRUNE_ABOVE {
        map.retain(|_, e| !e.stale(now));
    }
}

impl LoginThrottle {
    /// Refuse an attempt while its account or its IP is waiting; otherwise
    /// count it as a failure for both right away, before the password is
    /// checked, so concurrent attempts can't all slip through before the
    /// first one is counted. A correct password gives it back
    /// ([`Self::record_success`]); a wrong one needs nothing more.
    pub fn try_attempt(&self, email: &str, ip: &str, now: Instant) -> Result<(), Blocked> {
        // Both locks at once, always accounts first: the refusal check and
        // the count happen as one step. Nothing is awaited while held.
        let mut accounts = lock(&self.accounts);
        let mut ips = lock(&self.ips);
        let key = account_key(email);
        if let Some(b) = accounts
            .get_mut(&key)
            .and_then(|e| e.refuse(now, Reason::Account))
        {
            return Err(b);
        }
        if let Some(b) = ips.get_mut(ip).and_then(|e| e.refuse(now, Reason::Ip)) {
            return Err(b);
        }

        prune(&mut accounts, now);
        let entry = accounts.entry(key).or_default();
        let n = entry.fail(now);
        if n >= ACCOUNT_FREE_FAILURES {
            let doublings = (n - ACCOUNT_FREE_FAILURES).min(4);
            let wait = (ACCOUNT_FIRST_WAIT * 2u32.pow(doublings)).min(MAX_WAIT);
            entry.block(now, wait);
        }
        prune(&mut ips, now);
        let entry = ips.entry(ip.to_string()).or_default();
        if entry.fail(now) >= IP_MAX_FAILURES {
            entry.block(now, MAX_WAIT);
        }
        Ok(())
    }

    /// A correct login clears its account and gives back the failure its
    /// attempt reserved on the IP. The IP keeps its other failures, and a wait
    /// earned by thirty real failures stays; only a wait this very attempt's
    /// reservation started is lifted.
    pub fn record_success(&self, email: &str, ip: &str) {
        lock(&self.accounts).remove(&account_key(email));
        if let Some(entry) = lock(&self.ips).get_mut(ip) {
            entry.failures = entry.failures.saturating_sub(1);
            if entry.failures < IP_MAX_FAILURES {
                entry.blocked_until = None;
            }
        }
    }

    /// How many accounts and IPs have an entry.
    #[cfg(test)]
    pub(crate) fn tracked_keys(&self) -> (usize, usize) {
        (lock(&self.accounts).len(), lock(&self.ips).len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: Duration = Duration::from_secs(60);

    /// `times` wrong passwords: attempts that must be let through.
    fn fail(t: &LoginThrottle, email: &str, ip: &str, now: Instant, times: u32) {
        for _ in 0..times {
            t.try_attempt(email, ip, now).expect("attempt let through");
        }
    }

    /// One correct password.
    fn succeed(t: &LoginThrottle, email: &str, ip: &str, now: Instant) {
        t.try_attempt(email, ip, now).expect("attempt let through");
        t.record_success(email, ip);
    }

    /// Whether an attempt would be refused, without making one.
    fn peek(
        t: &LoginThrottle,
        email: &str,
        ip: &str,
        now: Instant,
    ) -> Result<(), (Reason, Duration)> {
        let waiting = |m: &Mutex<HashMap<String, Entry>>, k: &str| {
            lock(m).get(k).and_then(|e| e.blocked_for(now))
        };
        if let Some(d) = waiting(&t.accounts, &account_key(email)) {
            return Err((Reason::Account, d));
        }
        if let Some(d) = waiting(&t.ips, ip) {
            return Err((Reason::Ip, d));
        }
        Ok(())
    }

    #[test]
    fn four_failures_are_free_the_fifth_starts_a_one_minute_wait() {
        let t = LoginThrottle::default();
        let now = Instant::now();
        fail(&t, "a@t.local", "1.1.1.1", now, 4);
        assert_eq!(peek(&t, "a@t.local", "1.1.1.1", now), Ok(()));
        fail(&t, "a@t.local", "1.1.1.1", now, 1);
        let b = t.try_attempt("a@t.local", "1.1.1.1", now).unwrap_err();
        assert_eq!(b.reason, Reason::Account);
        assert_eq!(b.retry_after, MIN);
        assert_eq!(b.retry_after_secs(), 60);
        assert_eq!(peek(&t, "a@t.local", "1.1.1.1", now + MIN), Ok(()));
    }

    #[test]
    fn waits_double_and_cap_at_fifteen_minutes() {
        let t = LoginThrottle::default();
        let mut now = Instant::now();
        fail(&t, "a@t.local", "ip", now, 4);
        for expected in [1, 2, 4, 8, 15, 15] {
            fail(&t, "a@t.local", "ip", now, 1);
            let b = t.try_attempt("a@t.local", "ip", now).unwrap_err();
            assert_eq!(b.retry_after, MIN * expected);
            // Next attempt right when the wait ends, still inside the window.
            now += b.retry_after;
        }
    }

    #[test]
    fn a_refused_attempt_is_not_counted() {
        let t = LoginThrottle::default();
        let now = Instant::now();
        fail(&t, "a@t.local", "ip", now, 5);
        for _ in 0..10 {
            t.try_attempt("a@t.local", "ip", now).unwrap_err();
        }
        // Still the first wait's end, and the next failure starts 2 minutes.
        fail(&t, "a@t.local", "ip", now + MIN, 1);
        let b = t.try_attempt("a@t.local", "ip", now + MIN).unwrap_err();
        assert_eq!(b.retry_after, MIN * 2);
    }

    #[test]
    fn only_the_first_refusal_of_each_wait_is_flagged() {
        let t = LoginThrottle::default();
        let now = Instant::now();
        fail(&t, "a@t.local", "ip", now, 5);
        assert!(
            t.try_attempt("a@t.local", "ip", now)
                .unwrap_err()
                .first_refusal
        );
        for _ in 0..3 {
            assert!(
                !t.try_attempt("a@t.local", "ip", now)
                    .unwrap_err()
                    .first_refusal
            );
        }
        // The next wait gets its own first refusal.
        fail(&t, "a@t.local", "ip", now + MIN, 1);
        assert!(
            t.try_attempt("a@t.local", "ip", now + MIN)
                .unwrap_err()
                .first_refusal
        );
        assert!(
            !t.try_attempt("a@t.local", "ip", now + MIN)
                .unwrap_err()
                .first_refusal
        );
    }

    #[test]
    fn the_key_ignores_case_and_surrounding_spaces() {
        let t = LoginThrottle::default();
        let now = Instant::now();
        fail(&t, " A@T.local ", "ip", now, 5);
        assert!(t.try_attempt("a@t.local", "ip", now).is_err());
    }

    #[test]
    fn success_clears_the_account() {
        let t = LoginThrottle::default();
        let now = Instant::now();
        fail(&t, "a@t.local", "ip", now, 4);
        succeed(&t, "a@t.local", "ip", now);
        fail(&t, "a@t.local", "ip", now, 4);
        assert_eq!(peek(&t, "a@t.local", "ip", now), Ok(()));
    }

    #[test]
    fn a_correct_fifth_attempt_is_not_left_waiting() {
        let t = LoginThrottle::default();
        let now = Instant::now();
        fail(&t, "a@t.local", "ip", now, 4);
        succeed(&t, "a@t.local", "ip", now);
        assert_eq!(peek(&t, "a@t.local", "ip", now), Ok(()));
    }

    #[test]
    fn failures_older_than_the_window_are_forgotten() {
        let t = LoginThrottle::default();
        let now = Instant::now();
        fail(&t, "a@t.local", "ip", now, 4);
        let later = now + Duration::from_secs(15 * 60 + 1);
        fail(&t, "a@t.local", "ip", later, 1);
        assert_eq!(peek(&t, "a@t.local", "ip", later), Ok(()));
    }

    #[test]
    fn one_ip_trying_many_accounts_is_stopped_after_thirty() {
        let t = LoginThrottle::default();
        let now = Instant::now();
        for i in 0..29 {
            fail(&t, &format!("u{i}@t.local"), "6.6.6.6", now, 1);
        }
        assert_eq!(peek(&t, "fresh@t.local", "6.6.6.6", now), Ok(()));
        fail(&t, "u29@t.local", "6.6.6.6", now, 1);
        let b = t.try_attempt("fresh@t.local", "6.6.6.6", now).unwrap_err();
        assert_eq!(b.reason, Reason::Ip);
        assert_eq!(b.retry_after, MIN * 15);
        // Another IP is unaffected, and a success there doesn't clear this one.
        succeed(&t, "fresh@t.local", "7.7.7.7", now);
        assert!(t.try_attempt("fresh@t.local", "6.6.6.6", now).is_err());
    }

    #[test]
    fn a_success_gives_back_its_ip_attempt() {
        let t = LoginThrottle::default();
        let now = Instant::now();
        for i in 0..28 {
            fail(&t, &format!("u{i}@t.local"), "6.6.6.6", now, 1);
        }
        succeed(&t, "me@t.local", "6.6.6.6", now);
        // Without the refund this would be the IP's thirtieth failure.
        fail(&t, "u28@t.local", "6.6.6.6", now, 1);
        assert_eq!(peek(&t, "fresh@t.local", "6.6.6.6", now), Ok(()));
        fail(&t, "u29@t.local", "6.6.6.6", now, 1);
        assert!(peek(&t, "fresh@t.local", "6.6.6.6", now).is_err());
    }

    #[test]
    fn a_correct_thirtieth_attempt_does_not_block_its_ip() {
        let t = LoginThrottle::default();
        let now = Instant::now();
        for i in 0..29 {
            fail(&t, &format!("u{i}@t.local"), "6.6.6.6", now, 1);
        }
        succeed(&t, "me@t.local", "6.6.6.6", now);
        assert_eq!(peek(&t, "fresh@t.local", "6.6.6.6", now), Ok(()));
    }

    #[test]
    fn retry_after_secs_rounds_up() {
        let b = Blocked {
            retry_after: Duration::from_millis(1500),
            reason: Reason::Ip,
            first_refusal: true,
        };
        assert_eq!(b.retry_after_secs(), 2);
        let b = Blocked {
            retry_after: Duration::from_millis(1),
            reason: Reason::Ip,
            first_refusal: true,
        };
        assert_eq!(b.retry_after_secs(), 1);
    }
}
