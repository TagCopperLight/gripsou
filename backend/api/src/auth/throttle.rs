//! In-memory login throttle: slows guessing per account and per IP, and never locks an account for good.
//! Three limiters share the counting rules of [`Policy`]: passwords per account, attempts per IP, second-step codes per account.

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};
use uuid::Uuid;

const MIN: Duration = Duration::from_secs(60);
const PRUNE_ABOVE: usize = 10_000;

/// Failures are forgotten `window` after the last one; from the `free_failures`-th on, each starts a wait from `waits` (the last repeats).
pub struct Policy {
    pub window: Duration,
    pub free_failures: u32,
    pub waits: &'static [Duration],
    pub reason: Reason,
}

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

pub const IP: Policy = Policy {
    window: Duration::from_secs(15 * 60),
    free_failures: 30,
    waits: &[Duration::from_secs(15 * 60)],
    reason: Reason::Ip,
};

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
    /// True only for the first refusal of a wait, so a flood logs one line.
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
    refused: bool,
}

impl Entry {
    fn blocked_for(&self, now: Instant) -> Option<Duration> {
        self.blocked_until
            .map(|until| until.saturating_duration_since(now))
            .filter(|d| !d.is_zero())
    }

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

    /// Other failures stay, and so does any wait they earned: only a wait this reservation started is lifted.
    fn refund(&self, key: &str) {
        if let Some(entry) = lock(&self.keys).get_mut(key) {
            entry.failures = entry.failures.saturating_sub(1);
            if entry.failures < self.policy.free_failures {
                entry.blocked_until = None;
            }
        }
    }
}

/// Counts the attempt as a failure on all slots before the secret is checked, so concurrent attempts can't slip through.
/// Locks are taken in the order given: callers keep one global order (IP limiter last).
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

/// An unknown email is throttled as typed, so unknown addresses slow down like real ones.
#[derive(Debug, Clone, Copy)]
pub enum Account<'a> {
    User(Uuid),
    Email(&'a str),
}

impl Account<'_> {
    fn key(self) -> String {
        match self {
            Account::User(id) => format!("user:{id}"),
            Account::Email(email) => format!("email:{}", email.trim().to_lowercase()),
        }
    }
}

/// A panic while holding the lock leaves plain counters behind: still usable.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Each check counts the attempt as a failure up front; only [`Attempt::succeeded`] gives it back.
pub struct Throttles {
    passwords: Limiter,
    ips: Limiter,
    second_factor: Limiter,
}

impl Default for Throttles {
    fn default() -> Self {
        Throttles {
            passwords: Limiter::new(&PASSWORD),
            ips: Limiter::new(&IP),
            second_factor: Limiter::new(&SECOND_FACTOR),
        }
    }
}

#[must_use = "dropping an attempt leaves it counted as a failure"]
pub struct Attempt<'a> {
    clear: Vec<(&'a Limiter, String)>,
    refund_ip: Option<(&'a Limiter, String)>,
}

impl Attempt<'_> {
    /// Clears the account counters this attempt names and gives back the failure it reserved on the IP.
    /// Other IP failures stay, and so does a wait thirty real failures earned.
    pub fn succeeded(self) {
        for (limiter, key) in &self.clear {
            limiter.clear(key);
        }
        if let Some((limiter, ip)) = &self.refund_ip {
            limiter.refund(ip);
        }
    }
}

impl Throttles {
    pub fn password(
        &self,
        account: Account<'_>,
        ip: &str,
        now: Instant,
    ) -> Result<Attempt<'_>, Blocked> {
        let key = account.key();
        attempt(
            &[(&self.passwords, &key), (&self.ips, ip)],
            now,
            account,
            Some(ip),
        )?;
        Ok(Attempt {
            clear: vec![(&self.passwords, key)],
            refund_ip: Some((&self.ips, ip.to_string())),
        })
    }

    /// A right code also clears the account's password counter, which still holds the password step.
    pub fn login_code(&self, user: Uuid, ip: &str, now: Instant) -> Result<Attempt<'_>, Blocked> {
        let account = Account::User(user);
        let key = account.key();
        attempt(
            &[(&self.second_factor, &key), (&self.ips, ip)],
            now,
            account,
            Some(ip),
        )?;
        Ok(Attempt {
            clear: vec![(&self.second_factor, key.clone()), (&self.passwords, key)],
            refund_ip: Some((&self.ips, ip.to_string())),
        })
    }

    /// The caller is signed in: only the account's code counter applies.
    pub fn setup_code(&self, user: Uuid, now: Instant) -> Result<Attempt<'_>, Blocked> {
        let account = Account::User(user);
        let key = account.key();
        attempt(&[(&self.second_factor, &key)], now, account, None)?;
        Ok(Attempt {
            clear: vec![(&self.second_factor, key)],
            refund_ip: None,
        })
    }

    /// Names no account, and one shared counter would let a stranger lock the operator out: only the IP counts.
    pub fn setup(&self, ip: &str, now: Instant) -> Result<Attempt<'_>, Blocked> {
        try_all(&[(&self.ips, ip)], now).inspect_err(|b| log_refusal(b, None, Some(ip)))?;
        Ok(Attempt {
            clear: Vec::new(),
            refund_ip: Some((&self.ips, ip.to_string())),
        })
    }

    /// Names no account yet: only the IP counts. Finishing gives the failure back with [`Self::passkey_signed_in`].
    pub fn passkey_options(&self, ip: &str, now: Instant) -> Result<(), Blocked> {
        try_all(&[(&self.ips, ip)], now).inspect_err(|b| log_refusal(b, None, Some(ip)))
    }

    pub fn passkey_signed_in(&self, ip: &str) {
        self.ips.refund(ip);
    }

    #[cfg(test)]
    pub(crate) fn tracked_keys(&self) -> (usize, usize) {
        (lock(&self.passwords.keys).len(), lock(&self.ips.keys).len())
    }
}

fn attempt(
    slots: &[(&Limiter, &str)],
    now: Instant,
    account: Account<'_>,
    ip: Option<&str>,
) -> Result<(), Blocked> {
    try_all(slots, now).inspect_err(|b| log_refusal(b, Some(account), ip))
}

fn log_refusal(blocked: &Blocked, account: Option<Account<'_>>, ip: Option<&str>) {
    if !blocked.first_refusal {
        return;
    }
    let (user_id, email) = match account {
        Some(Account::User(id)) => (Some(id), None),
        Some(Account::Email(email)) => (None, Some(email)),
        None => (None, None),
    };
    tracing::warn!(
        user_id = user_id.map(tracing::field::display),
        email,
        ip,
        reason = blocked.reason.as_str(),
        "login throttled"
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn email(e: &str) -> Account<'_> {
        Account::Email(e)
    }

    fn fail(t: &Throttles, e: &str, ip: &str, now: Instant, times: u32) {
        for _ in 0..times {
            let _ = t.password(email(e), ip, now).expect("attempt let through");
        }
    }

    fn succeed(t: &Throttles, e: &str, ip: &str, now: Instant) {
        t.password(email(e), ip, now)
            .expect("attempt let through")
            .succeeded();
    }

    fn refused(t: &Throttles, e: &str, ip: &str, now: Instant) -> Blocked {
        t.password(email(e), ip, now).err().expect("refused")
    }

    fn peek(t: &Throttles, e: &str, ip: &str, now: Instant) -> Result<(), (Reason, Duration)> {
        let waiting = |l: &Limiter, k: &str| lock(&l.keys).get(k).and_then(|e| e.blocked_for(now));
        if let Some(d) = waiting(&t.passwords, &email(e).key()) {
            return Err((Reason::Account, d));
        }
        if let Some(d) = waiting(&t.ips, ip) {
            return Err((Reason::Ip, d));
        }
        Ok(())
    }

    #[test]
    fn four_failures_are_free_the_fifth_starts_a_one_minute_wait() {
        let t = Throttles::default();
        let now = Instant::now();
        fail(&t, "a@t.local", "1.1.1.1", now, 4);
        assert_eq!(peek(&t, "a@t.local", "1.1.1.1", now), Ok(()));
        fail(&t, "a@t.local", "1.1.1.1", now, 1);
        let b = refused(&t, "a@t.local", "1.1.1.1", now);
        assert_eq!(b.reason, Reason::Account);
        assert_eq!(b.retry_after, MIN);
        assert_eq!(b.retry_after_secs(), 60);
        assert_eq!(peek(&t, "a@t.local", "1.1.1.1", now + MIN), Ok(()));
    }

    #[test]
    fn waits_double_and_cap_at_fifteen_minutes() {
        let t = Throttles::default();
        let mut now = Instant::now();
        fail(&t, "a@t.local", "ip", now, 4);
        for expected in [1, 2, 4, 8, 15, 15] {
            fail(&t, "a@t.local", "ip", now, 1);
            let b = refused(&t, "a@t.local", "ip", now);
            assert_eq!(b.retry_after, MIN * expected);
            now += b.retry_after;
        }
    }

    #[test]
    fn a_refused_attempt_is_not_counted() {
        let t = Throttles::default();
        let now = Instant::now();
        fail(&t, "a@t.local", "ip", now, 5);
        for _ in 0..10 {
            refused(&t, "a@t.local", "ip", now);
        }
        fail(&t, "a@t.local", "ip", now + MIN, 1);
        let b = refused(&t, "a@t.local", "ip", now + MIN);
        assert_eq!(b.retry_after, MIN * 2);
    }

    #[test]
    fn only_the_first_refusal_of_each_wait_is_flagged() {
        let t = Throttles::default();
        let now = Instant::now();
        fail(&t, "a@t.local", "ip", now, 5);
        assert!(refused(&t, "a@t.local", "ip", now).first_refusal);
        for _ in 0..3 {
            assert!(!refused(&t, "a@t.local", "ip", now).first_refusal);
        }
        fail(&t, "a@t.local", "ip", now + MIN, 1);
        assert!(refused(&t, "a@t.local", "ip", now + MIN).first_refusal);
        assert!(!refused(&t, "a@t.local", "ip", now + MIN).first_refusal);
    }

    #[test]
    fn an_email_key_ignores_case_and_surrounding_spaces() {
        let t = Throttles::default();
        let now = Instant::now();
        fail(&t, " A@T.local ", "ip", now, 5);
        assert!(t.password(email("a@t.local"), "ip", now).is_err());
    }

    #[test]
    fn success_clears_the_account() {
        let t = Throttles::default();
        let now = Instant::now();
        fail(&t, "a@t.local", "ip", now, 4);
        succeed(&t, "a@t.local", "ip", now);
        fail(&t, "a@t.local", "ip", now, 4);
        assert_eq!(peek(&t, "a@t.local", "ip", now), Ok(()));
    }

    #[test]
    fn a_correct_fifth_attempt_is_not_left_waiting() {
        let t = Throttles::default();
        let now = Instant::now();
        fail(&t, "a@t.local", "ip", now, 4);
        succeed(&t, "a@t.local", "ip", now);
        assert_eq!(peek(&t, "a@t.local", "ip", now), Ok(()));
    }

    #[test]
    fn failures_older_than_the_window_are_forgotten() {
        let t = Throttles::default();
        let now = Instant::now();
        fail(&t, "a@t.local", "ip", now, 4);
        let later = now + Duration::from_secs(15 * 60 + 1);
        fail(&t, "a@t.local", "ip", later, 1);
        assert_eq!(peek(&t, "a@t.local", "ip", later), Ok(()));
    }

    #[test]
    fn one_ip_trying_many_accounts_is_stopped_after_thirty() {
        let t = Throttles::default();
        let now = Instant::now();
        for i in 0..29 {
            fail(&t, &format!("u{i}@t.local"), "6.6.6.6", now, 1);
        }
        assert_eq!(peek(&t, "fresh@t.local", "6.6.6.6", now), Ok(()));
        fail(&t, "u29@t.local", "6.6.6.6", now, 1);
        let b = refused(&t, "fresh@t.local", "6.6.6.6", now);
        assert_eq!(b.reason, Reason::Ip);
        assert_eq!(b.retry_after, MIN * 15);
        succeed(&t, "fresh@t.local", "7.7.7.7", now);
        assert!(t.password(email("fresh@t.local"), "6.6.6.6", now).is_err());
    }

    #[test]
    fn a_success_gives_back_its_ip_attempt() {
        let t = Throttles::default();
        let now = Instant::now();
        for i in 0..28 {
            fail(&t, &format!("u{i}@t.local"), "6.6.6.6", now, 1);
        }
        succeed(&t, "me@t.local", "6.6.6.6", now);
        fail(&t, "u28@t.local", "6.6.6.6", now, 1);
        assert_eq!(peek(&t, "fresh@t.local", "6.6.6.6", now), Ok(()));
        fail(&t, "u29@t.local", "6.6.6.6", now, 1);
        assert!(peek(&t, "fresh@t.local", "6.6.6.6", now).is_err());
    }

    #[test]
    fn a_correct_thirtieth_attempt_does_not_block_its_ip() {
        let t = Throttles::default();
        let now = Instant::now();
        for i in 0..29 {
            fail(&t, &format!("u{i}@t.local"), "6.6.6.6", now, 1);
        }
        succeed(&t, "me@t.local", "6.6.6.6", now);
        assert_eq!(peek(&t, "fresh@t.local", "6.6.6.6", now), Ok(()));
    }

    #[test]
    fn passkey_attempts_count_on_the_ip_and_a_sign_in_gives_one_back() {
        let t = Throttles::default();
        let now = Instant::now();
        for _ in 0..30 {
            t.passkey_options("1.2.3.4", now).unwrap();
        }
        assert!(t.passkey_options("1.2.3.4", now).is_err());
        assert!(
            t.password(email("a@t.local"), "1.2.3.4", now).is_err(),
            "same IP limit as passwords"
        );
        let t = Throttles::default();
        for _ in 0..29 {
            t.passkey_options("1.2.3.4", now).unwrap();
        }
        t.passkey_signed_in("1.2.3.4");
        t.passkey_options("1.2.3.4", now).unwrap();
        t.passkey_options("1.2.3.4", now)
            .expect("the refund made room for one more");
    }

    #[test]
    fn second_factor_waits_grow_to_an_hour_and_stay_there() {
        let t = Throttles::default();
        let u = Uuid::new_v4();
        let mut now = Instant::now();
        for _ in 0..4 {
            let _ = t.setup_code(u, now).expect("free failure");
        }
        for expected in [1, 2, 4, 8, 15, 30, 60, 60, 60] {
            let _ = t.setup_code(u, now).expect("let through");
            let b = t.setup_code(u, now).err().unwrap();
            assert_eq!(b.reason, Reason::SecondFactor);
            assert_eq!(b.reason.as_str(), "second_factor");
            assert_eq!(b.retry_after, MIN * expected);
            now += b.retry_after;
        }
    }

    #[test]
    fn second_factor_failures_twenty_minutes_apart_are_remembered() {
        let t = Throttles::default();
        let u = Uuid::new_v4();
        let mut now = Instant::now();
        for _ in 0..4 {
            let _ = t.setup_code(u, now).expect("free failure");
            now += MIN * 20;
        }
        let _ = t.setup_code(u, now).expect("fifth let through");
        let b = t.setup_code(u, now).err().unwrap();
        assert_eq!(b.retry_after, MIN);
        let later = now + Duration::from_secs(24 * 3600 + 1);
        let _ = t.setup_code(u, later).expect("forgotten");
        let _ = t.setup_code(u, later).expect("still free");
    }

    #[test]
    fn second_factor_success_clears_the_account() {
        let t = Throttles::default();
        let u = Uuid::new_v4();
        let now = Instant::now();
        for _ in 0..4 {
            let _ = t.setup_code(u, now).unwrap();
        }
        t.setup_code(u, now).unwrap().succeeded();
        for _ in 0..5 {
            let _ = t.setup_code(u, now).expect("cleared");
        }
    }

    #[test]
    fn login_codes_count_the_ip_and_not_the_password_account() {
        let t = Throttles::default();
        let u = Uuid::new_v4();
        let now = Instant::now();
        for _ in 0..5 {
            let _ = t.login_code(u, "ip", now).unwrap();
        }
        let b = t.login_code(u, "ip", now).err().unwrap();
        assert_eq!(b.reason, Reason::SecondFactor);
        let _ = t.password(Account::User(u), "ip", now).expect("not slowed");
        for i in 0..24 {
            fail(&t, &format!("u{i}@t.local"), "ip", now, 1);
        }
        assert_eq!(refused(&t, "fresh@t.local", "ip", now).reason, Reason::Ip);
    }

    #[test]
    fn login_codes_are_refused_while_the_ip_waits() {
        let t = Throttles::default();
        let now = Instant::now();
        for i in 0..30 {
            fail(&t, &format!("u{i}@t.local"), "6.6.6.6", now, 1);
        }
        let u = Uuid::new_v4();
        let b = t.login_code(u, "6.6.6.6", now).err().unwrap();
        assert_eq!(b.reason, Reason::Ip);
        for _ in 0..5 {
            let _ = t.login_code(u, "7.7.7.7", now).expect("not counted");
        }
    }

    #[test]
    fn a_right_login_code_clears_both_accounts_and_refunds_the_ip() {
        let t = Throttles::default();
        let u = Uuid::new_v4();
        let now = Instant::now();
        let _ = t.password(Account::User(u), "ip", now).unwrap();
        let _ = t.login_code(u, "ip", now).unwrap();
        t.login_code(u, "ip", now).unwrap().succeeded();
        for _ in 0..5 {
            let _ = t.login_code(u, "7.7.7.7", now).expect("codes cleared");
            let _ = t
                .password(Account::User(u), "8.8.8.8", now)
                .expect("password cleared");
        }
        for i in 0..28 {
            fail(&t, &format!("u{i}@t.local"), "ip", now, 1);
        }
        assert_eq!(refused(&t, "fresh@t.local", "ip", now).reason, Reason::Ip);
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
