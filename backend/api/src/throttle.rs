//! In-memory login throttle: slows guessing per account and per IP. It never
//! locks an account for good, but someone who keeps sending wrong passwords
//! for an account's email keeps its password login in waits for as long as
//! they go on; passkey sign-in, counted per IP only, still works. gripsou runs
//! as one instance, so a restart clearing the counters is acceptable (an
//! attacker can't trigger one).
//!
//! Two limiters share the same counting rules ([`Policy`]):
//! - [`LoginThrottle`] for passwords (per account, short memory) and per IP;
//! - [`SecondFactorThrottle`] for second-step codes (per account, a day of
//!   memory and longer waits), because someone who knows the password could
//!   otherwise keep guessing codes at the password limiter's pace forever.

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

const MIN: Duration = Duration::from_secs(60);
/// Above this many keys, stale entries are dropped on the next failure.
const PRUNE_ABOVE: usize = 10_000;

/// How one limiter counts: failures are remembered until `window` has passed
/// since the last one; from the `free_failures`-th failure on, each failure
/// starts a wait taken from `waits` (the last entry repeats).
pub struct Policy {
    pub window: Duration,
    pub free_failures: u32,
    pub waits: &'static [Duration],
    pub reason: Reason,
}

/// Wrong passwords per account.
pub const PASSWORD: Policy = Policy {
    window: Duration::from_secs(15 * 60),
    free_failures: 5,
    waits: &[
        MIN,
        Duration::from_secs(2 * 60),
        Duration::from_secs(4 * 60),
        Duration::from_secs(8 * 60),
        Duration::from_secs(15 * 60),
    ],
    reason: Reason::Account,
};

/// Failed attempts per IP, whichever account they aim at.
pub const IP: Policy = Policy {
    window: Duration::from_secs(15 * 60),
    free_failures: 30,
    waits: &[Duration::from_secs(15 * 60)],
    reason: Reason::Ip,
};

/// Wrong second-step codes per account: remembered for a day, so patient
/// guessing keeps paying the longest wait.
pub const SECOND_FACTOR: Policy = Policy {
    window: Duration::from_secs(24 * 3600),
    free_failures: 5,
    waits: &[
        MIN,
        Duration::from_secs(2 * 60),
        Duration::from_secs(4 * 60),
        Duration::from_secs(8 * 60),
        Duration::from_secs(15 * 60),
        Duration::from_secs(30 * 60),
        Duration::from_secs(60 * 60),
    ],
    reason: Reason::SecondFactor,
};

impl Policy {
    /// The wait the `n`-th failure in a row starts, if any.
    fn wait_after(&self, n: u32) -> Option<Duration> {
        let past = n.checked_sub(self.free_failures)?;
        let i = (past as usize).min(self.waits.len() - 1);
        Some(self.waits[i])
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reason {
    Account,
    Ip,
    SecondFactor,
}

impl Reason {
    pub fn as_str(self) -> &'static str {
        match self {
            Reason::Account => "account",
            Reason::Ip => "ip",
            Reason::SecondFactor => "second_factor",
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

    /// Count one failure, forgetting earlier ones outside the window, and
    /// start the wait it earns.
    fn fail(&mut self, now: Instant, policy: &Policy) {
        if self
            .last_failure
            .is_some_and(|t| now.saturating_duration_since(t) > policy.window)
        {
            self.failures = 0;
        }
        self.failures += 1;
        self.last_failure = Some(now);
        if let Some(wait) = policy.wait_after(self.failures) {
            self.blocked_until = Some(now + wait);
            self.refused = false;
        }
    }

    fn stale(&self, now: Instant, window: Duration) -> bool {
        self.blocked_for(now).is_none()
            && self
                .last_failure
                .is_none_or(|t| now.saturating_duration_since(t) > window)
    }
}

/// One counter per key (an account or an IP) under one [`Policy`].
struct Limiter {
    policy: &'static Policy,
    keys: Mutex<HashMap<String, Entry>>,
}

impl Limiter {
    fn new(policy: &'static Policy) -> Self {
        Limiter {
            policy,
            keys: Mutex::new(HashMap::new()),
        }
    }

    fn clear(&self, key: &str) {
        lock(&self.keys).remove(key);
    }

    /// Give back one reserved failure. Other failures stay, and so does a
    /// wait they earned; only a wait this very reservation started is lifted.
    fn refund(&self, key: &str) {
        if let Some(entry) = lock(&self.keys).get_mut(key) {
            entry.failures = entry.failures.saturating_sub(1);
            if entry.failures < self.policy.free_failures {
                entry.blocked_until = None;
            }
        }
    }
}

/// Refuse the attempt while any of `slots` (limiter, key) is waiting;
/// otherwise count it as a failure on all of them right away, before the
/// secret is checked, so concurrent attempts can't all slip through before
/// the first one is counted. Every lock is held for the whole step, taken in
/// the order given; callers keep one global order (an IP limiter last).
fn try_all(slots: &[(&Limiter, &str)], now: Instant) -> Result<(), Blocked> {
    let mut guards: Vec<_> = slots.iter().map(|(l, _)| lock(&l.keys)).collect();
    for ((limiter, key), map) in slots.iter().zip(guards.iter_mut()) {
        if let Some(b) = map
            .get_mut(*key)
            .and_then(|e| e.refuse(now, limiter.policy.reason))
        {
            return Err(b);
        }
    }
    for ((limiter, key), map) in slots.iter().zip(guards.iter_mut()) {
        if map.len() > PRUNE_ABOVE {
            map.retain(|_, e| !e.stale(now, limiter.policy.window));
        }
        map.entry(key.to_string())
            .or_default()
            .fail(now, limiter.policy);
    }
    Ok(())
}

fn account_key(email: &str) -> String {
    email.trim().to_lowercase()
}

/// A panic while holding the lock leaves plain counters behind: still usable.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Password attempts, per account and per IP.
pub struct LoginThrottle {
    accounts: Limiter,
    ips: Limiter,
}

impl Default for LoginThrottle {
    fn default() -> Self {
        LoginThrottle {
            accounts: Limiter::new(&PASSWORD),
            ips: Limiter::new(&IP),
        }
    }
}

impl LoginThrottle {
    /// Refuse an attempt while its account or its IP is waiting; otherwise
    /// count it as a failure for both right away, before the password is
    /// checked. A correct password gives it back ([`Self::record_success`]);
    /// a wrong one needs nothing more.
    pub fn try_attempt(&self, email: &str, ip: &str, now: Instant) -> Result<(), Blocked> {
        let key = account_key(email);
        try_all(&[(&self.accounts, &key), (&self.ips, ip)], now)
    }

    /// A correct login clears its account and gives back the failure its
    /// attempt reserved on the IP. The IP keeps its other failures, and a wait
    /// earned by thirty real failures stays; only a wait this very attempt's
    /// reservation started is lifted.
    pub fn record_success(&self, email: &str, ip: &str) {
        self.accounts.clear(&account_key(email));
        self.ips.refund(ip);
    }

    /// A sign-in with no account to count against yet (passwordless passkey):
    /// only the IP limit applies. A success gives it back ([`Self::refund_ip`]).
    pub fn try_ip(&self, ip: &str, now: Instant) -> Result<(), Blocked> {
        try_all(&[(&self.ips, ip)], now)
    }

    pub fn refund_ip(&self, ip: &str) {
        self.ips.refund(ip);
    }

    /// How many accounts and IPs have an entry.
    #[cfg(test)]
    pub(crate) fn tracked_keys(&self) -> (usize, usize) {
        (lock(&self.accounts.keys).len(), lock(&self.ips.keys).len())
    }
}

/// Second-step codes (login authenticator or backup code, authenticator
/// setup confirmation), per account. Separate from [`LoginThrottle`] so its
/// long memory never slows down password logins.
pub struct SecondFactorThrottle {
    accounts: Limiter,
}

impl Default for SecondFactorThrottle {
    fn default() -> Self {
        SecondFactorThrottle {
            accounts: Limiter::new(&SECOND_FACTOR),
        }
    }
}

impl SecondFactorThrottle {
    /// A login code attempt: refused while the account's second-factor
    /// counter or the IP of `passwords` is waiting, otherwise counted on both
    /// up front. A right code gives it back ([`Self::record_login_success`]).
    pub fn try_login(
        &self,
        passwords: &LoginThrottle,
        email: &str,
        ip: &str,
        now: Instant,
    ) -> Result<(), Blocked> {
        let key = account_key(email);
        try_all(&[(&self.accounts, &key), (&passwords.ips, ip)], now)
    }

    /// A right login code clears the account here and in `passwords` (whose
    /// count still holds the password step) and gives back one IP failure.
    pub fn record_login_success(&self, passwords: &LoginThrottle, email: &str, ip: &str) {
        self.accounts.clear(&account_key(email));
        passwords.record_success(email, ip);
    }

    /// A code attempt with no IP limit (the caller is already signed in).
    pub fn try_attempt(&self, email: &str, now: Instant) -> Result<(), Blocked> {
        let key = account_key(email);
        try_all(&[(&self.accounts, &key)], now)
    }

    /// A right code clears the account.
    pub fn record_success(&self, email: &str) {
        self.accounts.clear(&account_key(email));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let waiting = |l: &Limiter, k: &str| lock(&l.keys).get(k).and_then(|e| e.blocked_for(now));
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
    fn ip_only_attempts_count_on_the_ip_and_a_refund_gives_one_back() {
        let t = LoginThrottle::default();
        let now = Instant::now();
        for _ in 0..30 {
            t.try_ip("1.2.3.4", now).unwrap();
        }
        assert!(t.try_ip("1.2.3.4", now).is_err());
        assert!(
            t.try_attempt("a@t.local", "1.2.3.4", now).is_err(),
            "same IP limit as passwords"
        );
        let t = LoginThrottle::default();
        for _ in 0..29 {
            t.try_ip("1.2.3.4", now).unwrap();
        }
        t.refund_ip("1.2.3.4");
        t.try_ip("1.2.3.4", now).unwrap();
        t.try_ip("1.2.3.4", now)
            .expect("the refund made room for one more");
    }

    #[test]
    fn second_factor_waits_grow_to_an_hour_and_stay_there() {
        let sf = SecondFactorThrottle::default();
        let mut now = Instant::now();
        for _ in 0..4 {
            sf.try_attempt("a@t.local", now).expect("free failure");
        }
        for expected in [1, 2, 4, 8, 15, 30, 60, 60, 60] {
            sf.try_attempt("a@t.local", now).expect("let through");
            let b = sf.try_attempt("a@t.local", now).unwrap_err();
            assert_eq!(b.reason, Reason::SecondFactor);
            assert_eq!(b.reason.as_str(), "second_factor");
            assert_eq!(b.retry_after, MIN * expected);
            now += b.retry_after;
        }
    }

    #[test]
    fn second_factor_failures_twenty_minutes_apart_are_remembered() {
        let sf = SecondFactorThrottle::default();
        let mut now = Instant::now();
        for _ in 0..4 {
            sf.try_attempt("a@t.local", now).expect("free failure");
            now += MIN * 20;
        }
        sf.try_attempt("a@t.local", now).expect("fifth let through");
        let b = sf.try_attempt("a@t.local", now).unwrap_err();
        assert_eq!(b.retry_after, MIN);
        // A day after the last failure, the slate is clean.
        let later = now + Duration::from_secs(24 * 3600 + 1);
        sf.try_attempt("a@t.local", later).expect("forgotten");
        sf.try_attempt("a@t.local", later).expect("still free");
    }

    #[test]
    fn second_factor_success_clears_the_account() {
        let sf = SecondFactorThrottle::default();
        let now = Instant::now();
        for _ in 0..4 {
            sf.try_attempt("A@t.local", now).unwrap();
        }
        sf.try_attempt("a@t.local", now).unwrap();
        sf.record_success("a@t.local");
        for _ in 0..5 {
            sf.try_attempt("a@t.local", now).expect("cleared");
        }
    }

    #[test]
    fn second_factor_login_counts_the_ip_and_not_the_password_account() {
        let pw = LoginThrottle::default();
        let sf = SecondFactorThrottle::default();
        let now = Instant::now();
        for _ in 0..5 {
            sf.try_login(&pw, "a@t.local", "ip", now).unwrap();
        }
        let b = sf.try_login(&pw, "a@t.local", "ip", now).unwrap_err();
        assert_eq!(b.reason, Reason::SecondFactor);
        // Password logins of that account are not slowed by wrong codes.
        assert_eq!(peek(&pw, "a@t.local", "ip", now), Ok(()));
        assert_eq!(pw.tracked_keys(), (0, 1));
        // A refused attempt counts nowhere.
        assert_eq!(lock(&pw.ips.keys).get("ip").unwrap().failures, 5);
    }

    #[test]
    fn second_factor_login_is_refused_while_the_ip_waits() {
        let pw = LoginThrottle::default();
        let sf = SecondFactorThrottle::default();
        let now = Instant::now();
        for i in 0..30 {
            fail(&pw, &format!("u{i}@t.local"), "6.6.6.6", now, 1);
        }
        let b = sf.try_login(&pw, "a@t.local", "6.6.6.6", now).unwrap_err();
        assert_eq!(b.reason, Reason::Ip);
        // Refused before counting: the second-factor counter is untouched.
        assert!(lock(&sf.accounts.keys).is_empty());
    }

    #[test]
    fn a_right_login_code_clears_both_accounts_and_refunds_the_ip() {
        let pw = LoginThrottle::default();
        let sf = SecondFactorThrottle::default();
        let now = Instant::now();
        // Password step, then a wrong and a right code.
        pw.try_attempt("a@t.local", "ip", now).unwrap();
        sf.try_login(&pw, "a@t.local", "ip", now).unwrap();
        sf.try_login(&pw, "a@t.local", "ip", now).unwrap();
        sf.record_login_success(&pw, "a@t.local", "ip");
        assert!(lock(&sf.accounts.keys).is_empty());
        assert_eq!(pw.tracked_keys(), (0, 1));
        assert_eq!(lock(&pw.ips.keys).get("ip").unwrap().failures, 2);
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
