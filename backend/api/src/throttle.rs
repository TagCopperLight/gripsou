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
}

impl Entry {
    fn blocked_for(&self, now: Instant) -> Option<Duration> {
        self.blocked_until
            .map(|until| until.saturating_duration_since(now))
            .filter(|d| !d.is_zero())
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
    /// Refuse an attempt while its account or its IP is waiting.
    pub fn check(&self, email: &str, ip: &str, now: Instant) -> Result<(), Blocked> {
        if let Some(d) = lock(&self.accounts)
            .get(&account_key(email))
            .and_then(|e| e.blocked_for(now))
        {
            return Err(Blocked {
                retry_after: d,
                reason: Reason::Account,
            });
        }
        if let Some(d) = lock(&self.ips).get(ip).and_then(|e| e.blocked_for(now)) {
            return Err(Blocked {
                retry_after: d,
                reason: Reason::Ip,
            });
        }
        Ok(())
    }

    pub fn record_failure(&self, email: &str, ip: &str, now: Instant) {
        {
            let mut accounts = lock(&self.accounts);
            prune(&mut accounts, now);
            let entry = accounts.entry(account_key(email)).or_default();
            let n = entry.fail(now);
            if n >= ACCOUNT_FREE_FAILURES {
                let doublings = (n - ACCOUNT_FREE_FAILURES).min(4);
                let wait = (ACCOUNT_FIRST_WAIT * 2u32.pow(doublings)).min(MAX_WAIT);
                entry.blocked_until = Some(now + wait);
            }
        }
        let mut ips = lock(&self.ips);
        prune(&mut ips, now);
        let entry = ips.entry(ip.to_string()).or_default();
        if entry.fail(now) >= IP_MAX_FAILURES {
            entry.blocked_until = Some(now + MAX_WAIT);
        }
    }

    /// A correct login clears its account (not its IP).
    pub fn record_success(&self, email: &str) {
        lock(&self.accounts).remove(&account_key(email));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: Duration = Duration::from_secs(60);

    fn fail(t: &LoginThrottle, email: &str, ip: &str, now: Instant, times: u32) {
        for _ in 0..times {
            t.record_failure(email, ip, now);
        }
    }

    #[test]
    fn four_failures_are_free_the_fifth_starts_a_one_minute_wait() {
        let t = LoginThrottle::default();
        let now = Instant::now();
        fail(&t, "a@t.local", "1.1.1.1", now, 4);
        assert_eq!(t.check("a@t.local", "1.1.1.1", now), Ok(()));
        fail(&t, "a@t.local", "1.1.1.1", now, 1);
        let b = t.check("a@t.local", "1.1.1.1", now).unwrap_err();
        assert_eq!(b.reason, Reason::Account);
        assert_eq!(b.retry_after, MIN);
        assert_eq!(b.retry_after_secs(), 60);
        assert_eq!(t.check("a@t.local", "1.1.1.1", now + MIN), Ok(()));
    }

    #[test]
    fn waits_double_and_cap_at_fifteen_minutes() {
        let t = LoginThrottle::default();
        let mut now = Instant::now();
        fail(&t, "a@t.local", "ip", now, 4);
        for expected in [1, 2, 4, 8, 15, 15] {
            t.record_failure("a@t.local", "ip", now);
            let b = t.check("a@t.local", "ip", now).unwrap_err();
            assert_eq!(b.retry_after, MIN * expected);
            // Next attempt right when the wait ends, still inside the window.
            now += b.retry_after;
        }
    }

    #[test]
    fn the_key_ignores_case_and_surrounding_spaces() {
        let t = LoginThrottle::default();
        let now = Instant::now();
        fail(&t, " A@T.local ", "ip", now, 5);
        assert!(t.check("a@t.local", "ip", now).is_err());
    }

    #[test]
    fn success_clears_the_account() {
        let t = LoginThrottle::default();
        let now = Instant::now();
        fail(&t, "a@t.local", "ip", now, 4);
        t.record_success("a@t.local");
        fail(&t, "a@t.local", "ip", now, 4);
        assert_eq!(t.check("a@t.local", "ip", now), Ok(()));
    }

    #[test]
    fn failures_older_than_the_window_are_forgotten() {
        let t = LoginThrottle::default();
        let now = Instant::now();
        fail(&t, "a@t.local", "ip", now, 4);
        let later = now + Duration::from_secs(15 * 60 + 1);
        fail(&t, "a@t.local", "ip", later, 1);
        assert_eq!(t.check("a@t.local", "ip", later), Ok(()));
    }

    #[test]
    fn one_ip_trying_many_accounts_is_stopped_after_thirty() {
        let t = LoginThrottle::default();
        let now = Instant::now();
        for i in 0..29 {
            t.record_failure(&format!("u{i}@t.local"), "6.6.6.6", now);
        }
        assert_eq!(t.check("fresh@t.local", "6.6.6.6", now), Ok(()));
        t.record_failure("u29@t.local", "6.6.6.6", now);
        let b = t.check("fresh@t.local", "6.6.6.6", now).unwrap_err();
        assert_eq!(b.reason, Reason::Ip);
        assert_eq!(b.retry_after, MIN * 15);
        // Another IP is unaffected, and a success doesn't clear the IP.
        assert_eq!(t.check("fresh@t.local", "7.7.7.7", now), Ok(()));
        t.record_success("fresh@t.local");
        assert!(t.check("fresh@t.local", "6.6.6.6", now).is_err());
    }

    #[test]
    fn retry_after_secs_rounds_up() {
        let b = Blocked {
            retry_after: Duration::from_millis(1500),
            reason: Reason::Ip,
        };
        assert_eq!(b.retry_after_secs(), 2);
        let b = Blocked {
            retry_after: Duration::from_millis(1),
            reason: Reason::Ip,
        };
        assert_eq!(b.retry_after_secs(), 1);
    }
}
