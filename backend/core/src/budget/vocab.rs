//! The budget's closed value sets, as the database and the API spell them.

use crate::text_enum::text_enum;

text_enum! {
    /// The SQL orders categories by position in this list.
    pub enum CategoryKind {
        Expense = "expense",
        Income = "income",
        Neutral = "neutral",
    }
}

text_enum! {
    pub enum CategorySource {
        User = "user",
        Pair = "pair",
        Ai = "ai",
    }
}

text_enum! {
    /// Found by `budget_category.seed_key`, whatever the user renamed them to.
    pub enum SeedKey {
        OtherExpense = "other_expense",
    }
}

text_enum! {
    pub enum SystemKey {
        InternalTransfer = "internal_transfer",
    }
}

text_enum! {
    pub enum AiRunOutcome {
        Running = "running",
        Ok = "ok",
        Partial = "partial",
        Error = "error",
    }
}

text_enum! {
    pub enum RowSource {
        Cash = "cash",
        Lot = "lot",
    }
}
