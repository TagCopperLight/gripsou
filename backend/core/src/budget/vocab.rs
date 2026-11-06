//! The budget's closed value sets, as the database and the API spell them.

use crate::text_enum::text_enum;

text_enum! {
    /// Listed in display order: categories are shown grouped by kind in this
    /// order (the SQL orders by each kind's position in this list).
    pub enum CategoryKind {
        Expense = "expense",
        Income = "income",
        /// Neither spending nor income: hidden from every total.
        Neutral = "neutral",
    }
}

text_enum! {
    /// Who wrote a transaction's category. A `user` write is final, `pair`
    /// outranks `ai`.
    pub enum CategorySource {
        User = "user",
        Pair = "pair",
        Ai = "ai",
    }
}

text_enum! {
    /// The seeded categories the code looks up (`budget_category.seed_key`),
    /// whatever the user renamed them to.
    pub enum SeedKey {
        /// The catch-all expense category ("Other").
        OtherExpense = "other_expense",
    }
}

text_enum! {
    /// `budget_category.system_key`: the protected rows the code writes to.
    pub enum SystemKey {
        InternalTransfer = "internal_transfer",
    }
}

text_enum! {
    /// `budget_ai_run.outcome`.
    pub enum AiRunOutcome {
        Running = "running",
        Ok = "ok",
        Partial = "partial",
        Error = "error",
    }
}

text_enum! {
    /// Which table a Transactions-list row comes from (`budget_transaction_rows`).
    pub enum RowSource {
        /// A `transaction` row: the cash ledger.
        Cash = "cash",
        /// A `lot` row: a purchase or sale.
        Lot = "lot",
    }
}
