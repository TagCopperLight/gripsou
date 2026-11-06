use super::*;
use serde_json::json;

fn auth(user_id: Uuid) -> AuthUser {
    AuthUser {
        user_id,
        session_id: Uuid::new_v4(),
    }
}

/// A user with one checking account; returns (user, account).
async fn seed_user(pool: &PgPool) -> (Uuid, Uuid) {
    let user_id = gripsou_core::testkit::seed_user(pool).await;
    let account_id: Uuid = sqlx::query_scalar(
        "with c as (insert into connection (user_id, provider_key, display_name) \
                    values ($1, 'powens', 'C') returning id) \
         insert into account (connection_id, name, currency, type_key, color) \
         select id, 'Current', 'EUR', 'checking', '#4dd0b1' from c returning id",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap();
    (user_id, account_id)
}

async fn seed_txn(pool: &PgPool, account_id: Uuid, description: &str) -> Uuid {
    sqlx::query_scalar(
        "insert into transaction (account_id, spent_on, type, amount, description) \
         values ($1, current_date, 'withdrawal', -12, $2) returning id",
    )
    .bind(account_id)
    .bind(description)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn category(pool: &PgPool, user_id: Uuid, key: &str) -> Uuid {
    sqlx::query_scalar(
        "select id from budget_category where user_id = $1 \
         and (default_key = $2 or system_key = $2)",
    )
    .bind(user_id)
    .bind(key)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn row(pool: &PgPool, id: Uuid) -> (Option<Uuid>, bool, i64) {
    sqlx::query_as(
        "select t.budget_category_id, t.checked_at is not null, \
                (select count(*) from budget_transaction_tag g where g.transaction_id = t.id) \
           from transaction t where t.id = $1",
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn patch(
    pool: &PgPool,
    user_id: Uuid,
    id: Uuid,
    body: serde_json::Value,
) -> Result<PatchTransactionResponse, ApiError> {
    patch_transaction(
        State(pool.clone()),
        auth(user_id),
        Path(id),
        Json(serde_json::from_value(body).unwrap()),
    )
    .await
    .map(|j| j.0)
}

async fn bulk(
    pool: &PgPool,
    user_id: Uuid,
    body: serde_json::Value,
) -> Result<UpdatedResponse, ApiError> {
    bulk_transactions(
        State(pool.clone()),
        auth(user_id),
        Json(serde_json::from_value(body).unwrap()),
    )
    .await
    .map(|j| j.0)
}

#[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
async fn a_partial_patch_leaves_the_other_fields_alone(pool: PgPool) {
    let (user_id, account) = seed_user(&pool).await;
    let id = seed_txn(&pool, account, "LECLERC").await;
    seed_txn(&pool, account, "LECLERC").await;
    let groceries = category(&pool, user_id, "groceries").await;

    let r = patch(&pool, user_id, id, json!({ "categoryId": groceries }))
        .await
        .unwrap();
    assert_eq!(r.same_description_count, Some(1));

    let r = patch(&pool, user_id, id, json!({ "checked": true }))
        .await
        .unwrap();
    assert_eq!(
        r.same_description_count, None,
        "no category change, no question"
    );
    assert_eq!(row(&pool, id).await, (Some(groceries), true, 0));

    let err = patch(&pool, user_id, id, json!({})).await.unwrap_err();
    assert_eq!(err.status(), StatusCode::BAD_REQUEST);
}

#[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
async fn a_patch_with_a_foreign_category_fails_whole(pool: PgPool) {
    let (user_id, account) = seed_user(&pool).await;
    let id = seed_txn(&pool, account, "LECLERC").await;
    let (stranger, _) = seed_user(&pool).await;
    let theirs = category(&pool, stranger, "groceries").await;
    let tag = tag::create_tag(&pool, user_id, "Holiday", None)
        .await
        .unwrap()
        .id;

    let err = patch(
        &pool,
        user_id,
        id,
        json!({ "categoryId": theirs, "tagIds": [tag], "checked": true }),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(row(&pool, id).await, (None, false, 0));

    let err = patch(&pool, stranger, id, json!({ "checked": true }))
        .await
        .unwrap_err();
    assert_eq!(err.status(), StatusCode::NOT_FOUND);
}

#[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
async fn a_patch_on_a_paired_row_asks_first(pool: PgPool) {
    let (user_id, account) = seed_user(&pool).await;
    let out = seed_txn(&pool, account, "VIREMENT").await;
    let inn = seed_txn(&pool, account, "VIREMENT RECU").await;
    sqlx::query(
        "update transaction set transfer_pair_id = case id when $1 then $2 else $1 end \
         where id in ($1, $2)",
    )
    .bind(out)
    .bind(inn)
    .execute(&pool)
    .await
    .unwrap();
    let groceries = category(&pool, user_id, "groceries").await;

    let r = patch(&pool, user_id, out, json!({ "categoryId": groceries }))
        .await
        .unwrap();
    assert_eq!(r.pending_pair_breaks, Some(1));
    assert_eq!(row(&pool, out).await.0, None, "nothing written");

    let r = patch(
        &pool,
        user_id,
        out,
        json!({ "categoryId": groceries, "confirmBreakPairs": true }),
    )
    .await
    .unwrap();
    assert_eq!(r.pending_pair_breaks, None);
    assert_eq!(row(&pool, out).await.0, Some(groceries));
}

/// A bulk `filter` is the list's own query parameters: an absent
/// `includeTransfers` hides transfers, `true` includes them.
#[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
async fn a_bulk_filter_includes_transfers_only_when_asked(pool: PgPool) {
    let (user_id, account) = seed_user(&pool).await;
    let spend = seed_txn(&pool, account, "LECLERC").await;
    let transfer = seed_txn(&pool, account, "VIREMENT").await;
    let internal = category(&pool, user_id, "internal_transfer").await;
    gripsou_core::testkit::set_category(&pool, user_id, transfer, Some(internal)).await;

    let r = bulk(
        &pool,
        user_id,
        json!({ "filter": { "bucket": "out" }, "checked": true }),
    )
    .await
    .unwrap();
    assert_eq!(r.updated, 1);
    assert!(row(&pool, spend).await.1);
    assert!(!row(&pool, transfer).await.1, "hidden, so untouched");

    let r = bulk(
        &pool,
        user_id,
        json!({ "filter": { "bucket": "out", "includeTransfers": true }, "checked": true }),
    )
    .await
    .unwrap();
    assert_eq!(r.updated, 2);
    assert!(row(&pool, transfer).await.1);
}

#[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
async fn a_bulk_takes_ids_or_a_filter_not_both(pool: PgPool) {
    let (user_id, account) = seed_user(&pool).await;
    let id = seed_txn(&pool, account, "LECLERC").await;

    let err = bulk(
        &pool,
        user_id,
        json!({ "ids": [id], "filter": {}, "checked": true }),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status(), StatusCode::BAD_REQUEST);

    let too_many: Vec<Uuid> = (0..=MAX_BULK_IDS).map(|_| Uuid::new_v4()).collect();
    let err = bulk(&pool, user_id, json!({ "ids": too_many, "checked": true }))
        .await
        .unwrap_err();
    assert_eq!(err.status(), StatusCode::BAD_REQUEST);

    let err = bulk(
        &pool,
        user_id,
        json!({ "filter": { "bucket": "sideways" }, "checked": true }),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status(), StatusCode::BAD_REQUEST, "unknown bucket");
    assert!(!row(&pool, id).await.1);
}

#[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
async fn deleting_a_category_is_404_409_or_204(pool: PgPool) {
    let (user_id, _) = seed_user(&pool).await;
    let (stranger, _) = seed_user(&pool).await;
    let groceries = category(&pool, user_id, "groceries").await;
    let internal = category(&pool, user_id, "internal_transfer").await;

    let del = |who: Uuid, id: Uuid| {
        let pool = pool.clone();
        async move { delete_category(State(pool), auth(who), Path(id)).await }
    };
    assert_eq!(
        del(stranger, groceries).await.unwrap_err().status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        del(user_id, internal).await.unwrap_err().status(),
        StatusCode::CONFLICT
    );
    assert_eq!(
        del(user_id, groceries).await.unwrap(),
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        del(user_id, groceries).await.unwrap_err().status(),
        StatusCode::NOT_FOUND
    );
}

#[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
async fn a_reorder_with_a_duplicate_id_is_refused(pool: PgPool) {
    let (user_id, _) = seed_user(&pool).await;
    let groceries = category(&pool, user_id, "groceries").await.to_string();
    let err = reorder_categories(
        State(pool.clone()),
        auth(user_id),
        Json(ReorderBody {
            ids: vec![groceries.clone(), groceries],
        }),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status(), StatusCode::BAD_REQUEST);
}

#[test]
fn a_twelve_month_mean_is_sent_to_the_cent() {
    assert_eq!(
        mean_to_string(Decimal::from(100) / Decimal::from(3)),
        "33.33"
    );
    assert_eq!(mean_to_string(Decimal::new(-5, 3)), "-0.01");
}

/// A cash row on a fixed date, so period tests do not depend on today.
async fn seed_dated(
    pool: &PgPool,
    account_id: Uuid,
    day: &str,
    amount: i64,
    description: &str,
) -> Uuid {
    let kind = if amount < 0 { "withdrawal" } else { "deposit" };
    sqlx::query_scalar(
        "insert into transaction (account_id, spent_on, type, amount, description) \
         values ($1, $2::date, $3, $4, $5) returning id",
    )
    .bind(account_id)
    .bind(day)
    .bind(kind)
    .bind(Decimal::from(amount))
    .bind(description)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// Files `txn` as an unreviewed, low-confidence AI guess: a review-queue row.
async fn ai_guess(pool: &PgPool, txn: Uuid, category_id: Uuid) {
    sqlx::query(
        "update transaction set budget_category_id = $2, category_source = 'ai', \
                category_confidence = 0.1, category_reviewed_at = null \
          where id = $1",
    )
    .bind(txn)
    .bind(category_id)
    .execute(pool)
    .await
    .unwrap();
}

/// (category, source, reviewed) — the fields the review writes touch.
async fn review_state(pool: &PgPool, txn: Uuid) -> (Option<Uuid>, Option<String>, bool) {
    sqlx::query_as(
        "select budget_category_id, category_source, category_reviewed_at is not null \
           from transaction where id = $1",
    )
    .bind(txn)
    .fetch_one(pool)
    .await
    .unwrap()
}

fn category_body(name: &str, kind: &str) -> CategoryBody {
    serde_json::from_value(json!({ "name": name, "color": "#123456", "kind": kind })).unwrap()
}

fn tag_body(name: &str) -> TagBody {
    serde_json::from_value(json!({ "name": name, "color": null })).unwrap()
}

async fn new_category(
    pool: &PgPool,
    user_id: Uuid,
    name: &str,
    kind: &str,
) -> Result<CategoryDto, ApiError> {
    create_category(
        State(pool.clone()),
        auth(user_id),
        Json(category_body(name, kind)),
    )
    .await
    .map(|(s, j)| {
        assert_eq!(s, StatusCode::CREATED);
        j.0
    })
}

async fn edit_category(
    pool: &PgPool,
    user_id: Uuid,
    id: Uuid,
    body: CategoryBody,
) -> Result<CategoryDto, ApiError> {
    update_category(State(pool.clone()), auth(user_id), Path(id), Json(body))
        .await
        .map(|j| j.0)
}

async fn new_tag(pool: &PgPool, user_id: Uuid, name: &str) -> Result<TagDto, ApiError> {
    create_tag(State(pool.clone()), auth(user_id), Json(tag_body(name)))
        .await
        .map(|(s, j)| {
            assert_eq!(s, StatusCode::CREATED);
            j.0
        })
}

async fn edit_tag(pool: &PgPool, user_id: Uuid, id: Uuid, name: &str) -> Result<TagDto, ApiError> {
    update_tag(
        State(pool.clone()),
        auth(user_id),
        Path(id),
        Json(tag_body(name)),
    )
    .await
    .map(|j| j.0)
}

async fn category_names(pool: &PgPool, user_id: Uuid) -> Vec<String> {
    list_categories(State(pool.clone()), auth(user_id))
        .await
        .unwrap()
        .0
        .into_iter()
        .map(|c| c.name)
        .collect()
}

async fn tag_names(pool: &PgPool, user_id: Uuid) -> Vec<String> {
    list_tags(State(pool.clone()), auth(user_id))
        .await
        .unwrap()
        .0
        .into_iter()
        .map(|t| t.name)
        .collect()
}

async fn undo(
    pool: &PgPool,
    user_id: Uuid,
    txn: Uuid,
    body: serde_json::Value,
) -> Result<StatusCode, ApiError> {
    undo_review(
        State(pool.clone()),
        auth(user_id),
        Path(txn),
        Json(serde_json::from_value(body).unwrap()),
    )
    .await
}

async fn summary_of(
    pool: &PgPool,
    user_id: Uuid,
    params: serde_json::Value,
) -> Result<SummaryDto, ApiError> {
    summary(
        State(pool.clone()),
        auth(user_id),
        Query(serde_json::from_value(params).unwrap()),
    )
    .await
    .map(|j| j.0)
}

async fn trend_of(
    pool: &PgPool,
    user_id: Uuid,
    params: serde_json::Value,
) -> Result<TrendDto, ApiError> {
    trend_handler(
        State(pool.clone()),
        auth(user_id),
        Query(serde_json::from_value(params).unwrap()),
    )
    .await
    .map(|j| j.0)
}

/// A category id is guessable from any shared link; the owner check is
/// what stops another account renaming someone else's taxonomy.
#[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
async fn a_stranger_cannot_edit_someone_elses_category(pool: PgPool) {
    let (owner, _) = seed_user(&pool).await;
    let (stranger, _) = seed_user(&pool).await;
    let mine = new_category(&pool, owner, "Climbing", "expense")
        .await
        .unwrap();
    let id = Uuid::parse_str(&mine.id).unwrap();

    let err = edit_category(&pool, stranger, id, category_body("Hijacked", "income"))
        .await
        .err()
        .unwrap();
    assert_eq!(err.status(), StatusCode::NOT_FOUND);
    assert!(
        category_names(&pool, owner)
            .await
            .contains(&"Climbing".into())
    );
}

/// Same owner check for tags: renaming is scoped to the caller.
#[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
async fn a_stranger_cannot_rename_someone_elses_tag(pool: PgPool) {
    let (owner, _) = seed_user(&pool).await;
    let (stranger, _) = seed_user(&pool).await;
    let id = Uuid::parse_str(&new_tag(&pool, owner, "Holiday").await.unwrap().id).unwrap();

    let err = edit_tag(&pool, stranger, id, "Hijacked")
        .await
        .err()
        .unwrap();
    assert_eq!(err.status(), StatusCode::NOT_FOUND);
    assert_eq!(tag_names(&pool, owner).await, vec!["Holiday".to_string()]);
}

/// Deleting a tag strips it from every transaction, so a cross-user
/// delete would silently erase another user's labelling.
#[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
async fn a_stranger_cannot_delete_someone_elses_tag(pool: PgPool) {
    let (owner, _) = seed_user(&pool).await;
    let (stranger, _) = seed_user(&pool).await;
    let id = Uuid::parse_str(&new_tag(&pool, owner, "Holiday").await.unwrap().id).unwrap();

    let err = delete_tag(State(pool.clone()), auth(stranger), Path(id))
        .await
        .err()
        .unwrap();
    assert_eq!(err.status(), StatusCode::NOT_FOUND);
    assert_eq!(tag_names(&pool, owner).await, vec!["Holiday".to_string()]);
}

/// The category list is the caller's taxonomy only — another user's
/// custom category must never show up in the picker.
#[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
async fn the_category_list_holds_only_the_callers_own(pool: PgPool) {
    let (owner, _) = seed_user(&pool).await;
    let (stranger, _) = seed_user(&pool).await;
    new_category(&pool, owner, "Climbing", "expense")
        .await
        .unwrap();

    let theirs = list_categories(State(pool.clone()), auth(stranger))
        .await
        .unwrap()
        .0;
    assert!(!theirs.iter().any(|c| c.name == "Climbing"));
    let owned: Vec<Uuid> = sqlx::query_scalar("select id from budget_category where user_id = $1")
        .bind(stranger)
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(
        theirs.len(),
        owned.len(),
        "exactly the stranger's seeded rows"
    );
    assert!(
        theirs
            .iter()
            .all(|c| owned.contains(&Uuid::parse_str(&c.id).unwrap()))
    );
}

/// Same for tags.
#[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
async fn the_tag_list_holds_only_the_callers_own(pool: PgPool) {
    let (owner, _) = seed_user(&pool).await;
    let (stranger, _) = seed_user(&pool).await;
    new_tag(&pool, owner, "Holiday").await.unwrap();
    new_tag(&pool, stranger, "Work").await.unwrap();

    assert_eq!(tag_names(&pool, stranger).await, vec!["Work".to_string()]);
    assert_eq!(tag_names(&pool, owner).await, vec!["Holiday".to_string()]);
}

/// Accepting marks the row reviewed; another user must not be able to
/// do that to a row that is not theirs (404, not 409, so the endpoint
/// does not even confirm the row exists).
#[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
async fn a_stranger_cannot_accept_a_review_on_someone_elses_row(pool: PgPool) {
    let (owner, account) = seed_user(&pool).await;
    let (stranger, _) = seed_user(&pool).await;
    let txn = seed_txn(&pool, account, "LECLERC").await;
    let groceries = category(&pool, owner, "groceries").await;
    ai_guess(&pool, txn, groceries).await;

    let err = accept_review(State(pool.clone()), auth(stranger), Path(txn))
        .await
        .err()
        .unwrap();
    assert_eq!(err.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        review_state(&pool, txn).await,
        (Some(groceries), Some("ai".into()), false)
    );
}

/// Undo rewrites the row's category; another user must not reach it.
#[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
async fn a_stranger_cannot_undo_a_review_on_someone_elses_row(pool: PgPool) {
    let (owner, account) = seed_user(&pool).await;
    let (stranger, _) = seed_user(&pool).await;
    let txn = seed_txn(&pool, account, "LECLERC").await;
    let groceries = category(&pool, owner, "groceries").await;
    gripsou_core::testkit::set_category(&pool, owner, txn, Some(groceries)).await;
    let before = review_state(&pool, txn).await;

    let err = undo(&pool, stranger, txn, json!({ "categoryId": null }))
        .await
        .status();
    assert_eq!(err, StatusCode::NOT_FOUND);
    assert_eq!(review_state(&pool, txn).await, before);
}

/// Undo can put a guess back only into one of the caller's own
/// categories: otherwise a row could point at another user's taxonomy.
#[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
async fn undo_into_a_strangers_category_is_refused(pool: PgPool) {
    let (owner, account) = seed_user(&pool).await;
    let (stranger, _) = seed_user(&pool).await;
    let txn = seed_txn(&pool, account, "LECLERC").await;
    let groceries = category(&pool, owner, "groceries").await;
    let theirs = category(&pool, stranger, "groceries").await;
    gripsou_core::testkit::set_category(&pool, owner, txn, Some(groceries)).await;
    let before = review_state(&pool, txn).await;

    let status = undo(&pool, owner, txn, json!({ "categoryId": theirs }))
        .await
        .status();
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(review_state(&pool, txn).await, before);
}

/// "Apply to all with this description" on someone else's row is a 404.
#[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
async fn apply_to_description_on_someone_elses_row_is_404(pool: PgPool) {
    let (_, account) = seed_user(&pool).await;
    let (stranger, _) = seed_user(&pool).await;
    let txn = seed_txn(&pool, account, "LECLERC").await;

    let err = apply_to_description(
        State(pool.clone()),
        auth(stranger),
        Path(txn),
        Json(serde_json::from_value(json!({ "categoryId": null })).unwrap()),
    )
    .await
    .err()
    .unwrap();
    assert_eq!(err.status(), StatusCode::NOT_FOUND);
}

/// Descriptions like "LECLERC" are shared by every user; "apply to all"
/// must sweep only the caller's rows, or one user's categorising would
/// rewrite everyone else's budget.
#[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
async fn apply_to_description_sweeps_only_the_callers_rows(pool: PgPool) {
    let (_, owner_account) = seed_user(&pool).await;
    let (stranger, stranger_account) = seed_user(&pool).await;
    let owners = seed_txn(&pool, owner_account, "LECLERC").await;
    let theirs = seed_txn(&pool, stranger_account, "LECLERC").await;
    let their_other = seed_txn(&pool, stranger_account, "LECLERC").await;
    let groceries = category(&pool, stranger, "groceries").await;

    let r = apply_to_description(
        State(pool.clone()),
        auth(stranger),
        Path(theirs),
        Json(serde_json::from_value(json!({ "categoryId": groceries })).unwrap()),
    )
    .await
    .unwrap()
    .0;
    assert_eq!(r.updated, 2);
    let mut ids = r.ids.unwrap();
    ids.sort();
    let mut want = vec![theirs, their_other];
    want.sort();
    assert_eq!(ids, want);
    assert_eq!(
        row(&pool, owners).await.0,
        None,
        "the owner's row untouched"
    );
}

/// Creating a category under an existing name is an ordinary UI mistake
/// and must read as 409, not an opaque 500.
#[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
async fn a_duplicate_category_name_is_409(pool: PgPool) {
    let (user_id, _) = seed_user(&pool).await;
    new_category(&pool, user_id, "Climbing", "expense")
        .await
        .unwrap();
    let err = new_category(&pool, user_id, "Climbing", "income")
        .await
        .err()
        .unwrap();
    assert_eq!(err.status(), StatusCode::CONFLICT);
}

/// Renaming a category onto another's name is the same 409.
#[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
async fn renaming_a_category_onto_an_existing_name_is_409(pool: PgPool) {
    let (user_id, _) = seed_user(&pool).await;
    new_category(&pool, user_id, "Climbing", "expense")
        .await
        .unwrap();
    let other = new_category(&pool, user_id, "Diving", "expense")
        .await
        .unwrap();
    let err = edit_category(
        &pool,
        user_id,
        Uuid::parse_str(&other.id).unwrap(),
        category_body("Climbing", "expense"),
    )
    .await
    .err()
    .unwrap();
    assert_eq!(err.status(), StatusCode::CONFLICT);
}

/// Names are unique per user, not globally: a second user may reuse one.
#[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
async fn two_users_may_share_a_category_name(pool: PgPool) {
    let (owner, _) = seed_user(&pool).await;
    let (stranger, _) = seed_user(&pool).await;
    new_category(&pool, owner, "Climbing", "expense")
        .await
        .unwrap();
    new_category(&pool, stranger, "Climbing", "expense")
        .await
        .unwrap();
}

/// Tags share the duplicate-name rule: 409 on create and on rename.
#[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
async fn a_duplicate_tag_name_is_409(pool: PgPool) {
    let (user_id, _) = seed_user(&pool).await;
    new_tag(&pool, user_id, "Holiday").await.unwrap();
    let other = new_tag(&pool, user_id, "Work").await.unwrap();

    let err = new_tag(&pool, user_id, "Holiday").await.err().unwrap();
    assert_eq!(err.status(), StatusCode::CONFLICT);
    let err = edit_tag(
        &pool,
        user_id,
        Uuid::parse_str(&other.id).unwrap(),
        "Holiday",
    )
    .await
    .err()
    .unwrap();
    assert_eq!(err.status(), StatusCode::CONFLICT);
}

/// A blank name would create a category nothing can display: 400, and
/// nothing written. (An unknown kind is refused with the body, see
/// `tests/router.rs`.)
#[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
async fn creating_a_category_needs_a_name(pool: PgPool) {
    let (user_id, _) = seed_user(&pool).await;
    let before = category_names(&pool, user_id).await.len();
    let err = new_category(&pool, user_id, "   ", "expense")
        .await
        .err()
        .unwrap();
    assert_eq!(err.status(), StatusCode::BAD_REQUEST);
    assert_eq!(category_names(&pool, user_id).await.len(), before);
}

/// The same check guards an edit, so a rename cannot blank a category.
#[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
async fn editing_a_category_needs_a_name(pool: PgPool) {
    let (user_id, _) = seed_user(&pool).await;
    let groceries = category(&pool, user_id, "groceries").await;
    let err = edit_category(&pool, user_id, groceries, category_body("", "expense"))
        .await
        .err()
        .unwrap();
    assert_eq!(err.status(), StatusCode::BAD_REQUEST);
}

/// A tag needs a name, on create and on rename.
#[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
async fn a_tag_needs_a_name(pool: PgPool) {
    let (user_id, _) = seed_user(&pool).await;
    let err = new_tag(&pool, user_id, "  ").await.err().unwrap();
    assert_eq!(err.status(), StatusCode::BAD_REQUEST);
    let id = Uuid::parse_str(&new_tag(&pool, user_id, "Holiday").await.unwrap().id).unwrap();
    let err = edit_tag(&pool, user_id, id, "").await.err().unwrap();
    assert_eq!(err.status(), StatusCode::BAD_REQUEST);
    assert_eq!(tag_names(&pool, user_id).await, vec!["Holiday".to_string()]);
}

/// The summary period is a month or a from/to pair, never ambiguous:
/// every other shape is a 400 rather than a silently guessed period.
#[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
async fn a_summary_period_must_be_one_month_or_an_ordered_range(pool: PgPool) {
    let (user_id, _) = seed_user(&pool).await;
    for params in [
        json!({}),
        json!({ "month": "2026-13" }),
        json!({ "month": "September" }),
        json!({ "from": "2026-03-01" }),
        json!({ "from": "2026-03-31", "to": "2026-03-01" }),
        json!({ "month": "2026-03", "from": "2026-03-01", "to": "2026-03-31" }),
    ] {
        let err = summary_of(&pool, user_id, params.clone())
            .await
            .err()
            .unwrap_or_else(|| panic!("{params} was accepted"));
        assert_eq!(err.status(), StatusCode::BAD_REQUEST, "{params}");
    }
}

/// The trend needs a parseable anchor and a 1..=24 month window.
#[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
async fn a_trend_needs_a_valid_anchor_and_window(pool: PgPool) {
    let (user_id, _) = seed_user(&pool).await;
    for params in [
        json!({ "anchor": "2026-13" }),
        json!({ "anchor": "2026-03", "months": 0 }),
        json!({ "anchor": "2026-03", "months": 25 }),
    ] {
        let err = trend_of(&pool, user_id, params.clone())
            .await
            .err()
            .unwrap_or_else(|| panic!("{params} was accepted"));
        assert_eq!(err.status(), StatusCode::BAD_REQUEST, "{params}");
    }
    assert!(
        trend_of(&pool, user_id, json!({ "anchor": "2026-03", "months": 24 }))
            .await
            .is_ok()
    );
}

/// The handler is the only range check on an undo's confidence: the
/// repository stores whatever it gets.
#[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
async fn an_undo_confidence_outside_0_to_1_is_400(pool: PgPool) {
    let (user_id, account) = seed_user(&pool).await;
    let txn = seed_txn(&pool, account, "LECLERC").await;
    let groceries = category(&pool, user_id, "groceries").await;
    gripsou_core::testkit::set_category(&pool, user_id, txn, Some(groceries)).await;
    let before = review_state(&pool, txn).await;
    for c in ["-0.01", "1.01"] {
        let status = undo(
            &pool,
            user_id,
            txn,
            json!({ "categoryId": groceries, "confidence": c }),
        )
        .await
        .status();
        assert_eq!(status, StatusCode::BAD_REQUEST, "{c}");
    }
    assert_eq!(review_state(&pool, txn).await, before);
}

/// Accepting a row that is not an unreviewed AI guess is 409: the row is
/// the caller's, but the action does not apply to it.
#[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
async fn accepting_a_row_not_in_review_is_409(pool: PgPool) {
    let (user_id, account) = seed_user(&pool).await;
    let txn = seed_txn(&pool, account, "LECLERC").await;
    let err = accept_review(State(pool.clone()), auth(user_id), Path(txn))
        .await
        .err()
        .unwrap();
    assert_eq!(err.status(), StatusCode::CONFLICT);
}

/// A tag created through the API is listed, renamed and deleted through
/// it, and a second delete is a 404.
#[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
async fn a_tag_round_trips_create_list_rename_delete(pool: PgPool) {
    let (user_id, _) = seed_user(&pool).await;
    let created = new_tag(&pool, user_id, "  Holiday  ").await.unwrap();
    assert_eq!(created.name, "Holiday", "trimmed");
    assert_eq!(created.tx_count, 0);
    let id = Uuid::parse_str(&created.id).unwrap();
    assert_eq!(tag_names(&pool, user_id).await, vec!["Holiday".to_string()]);

    let renamed = edit_tag(&pool, user_id, id, "Trip").await.unwrap();
    assert_eq!(
        (renamed.id.as_str(), renamed.name.as_str()),
        (created.id.as_str(), "Trip")
    );
    assert_eq!(tag_names(&pool, user_id).await, vec!["Trip".to_string()]);

    let del = |pool: PgPool| async move { delete_tag(State(pool), auth(user_id), Path(id)).await };
    assert_eq!(del(pool.clone()).await.unwrap(), StatusCode::NO_CONTENT);
    assert!(tag_names(&pool, user_id).await.is_empty());
    assert_eq!(
        del(pool.clone()).await.err().unwrap().status(),
        StatusCode::NOT_FOUND
    );
}

/// A category created through the API is listed, edited (name, kind,
/// archived) and deleted through it.
#[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
async fn a_category_round_trips_create_list_edit_delete(pool: PgPool) {
    let (user_id, _) = seed_user(&pool).await;
    let created = new_category(&pool, user_id, " Climbing ", "expense")
        .await
        .unwrap();
    assert_eq!(
        (
            created.name.as_str(),
            created.kind.as_str(),
            created.archived
        ),
        ("Climbing", "expense", false)
    );
    let id = Uuid::parse_str(&created.id).unwrap();
    assert!(
        category_names(&pool, user_id)
            .await
            .contains(&"Climbing".into())
    );

    let mut body = category_body("Bouldering", "neutral");
    body.archived = true;
    let edited = edit_category(&pool, user_id, id, body).await.unwrap();
    assert_eq!(
        (edited.name.as_str(), edited.kind.as_str(), edited.archived),
        ("Bouldering", "neutral", true)
    );
    let listed = list_categories(State(pool.clone()), auth(user_id))
        .await
        .unwrap()
        .0;
    let row = listed.iter().find(|c| c.id == created.id).unwrap();
    assert_eq!((row.name.as_str(), row.archived), ("Bouldering", true));

    assert_eq!(
        delete_category(State(pool.clone()), auth(user_id), Path(id))
            .await
            .unwrap(),
        StatusCode::NO_CONTENT
    );
    assert!(
        !category_names(&pool, user_id)
            .await
            .contains(&"Bouldering".into())
    );
}

/// Accept then undo is the review queue's "oops": the row must go back
/// exactly into the queue with the guess the client showed.
#[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
async fn undo_after_accept_puts_the_row_back_in_review(pool: PgPool) {
    let (user_id, account) = seed_user(&pool).await;
    let txn = seed_txn(&pool, account, "LECLERC").await;
    seed_txn(&pool, account, "LECLERC").await;
    let groceries = category(&pool, user_id, "groceries").await;
    ai_guess(&pool, txn, groceries).await;
    let threshold = gripsou_core::repo::prefs::review_threshold(&pool, user_id)
        .await
        .unwrap();
    assert_eq!(
        review::review_count(&pool, user_id, threshold)
            .await
            .unwrap(),
        1
    );

    let r = accept_review(State(pool.clone()), auth(user_id), Path(txn))
        .await
        .unwrap()
        .0;
    assert_eq!(r.same_description_count, 0, "the twin is not in review");
    assert_eq!(
        review_state(&pool, txn).await,
        (Some(groceries), Some("ai".into()), true)
    );
    assert_eq!(
        review::review_count(&pool, user_id, threshold)
            .await
            .unwrap(),
        0
    );

    let status = undo(
        &pool,
        user_id,
        txn,
        json!({ "categoryId": groceries, "confidence": "0.1" }),
    )
    .await
    .unwrap();
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(
        review_state(&pool, txn).await,
        (Some(groceries), Some("ai".into()), false)
    );
    assert_eq!(
        review::review_count(&pool, user_id, threshold)
            .await
            .unwrap(),
        1
    );
}

/// The summary endpoint wires the period through to the figures: one
/// salary and two purchases in March, one purchase outside it.
#[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
async fn a_month_summary_totals_its_own_rows(pool: PgPool) {
    let (user_id, account) = seed_user(&pool).await;
    seed_dated(&pool, account, "2026-03-01", 2000, "SALAIRE").await;
    seed_dated(&pool, account, "2026-03-10", -30, "LECLERC").await;
    seed_dated(&pool, account, "2026-03-31", -20, "LECLERC").await;
    seed_dated(&pool, account, "2026-04-01", -500, "LECLERC").await;

    let s = summary_of(&pool, user_id, json!({ "month": "2026-03" }))
        .await
        .unwrap();
    assert_eq!(s.txn_count, 3);
    assert_eq!(
        s.figures.income.amount.parse::<Decimal>().unwrap(),
        Decimal::from(2000)
    );
    assert_eq!(
        s.figures.expenses.amount.parse::<Decimal>().unwrap(),
        Decimal::from(50)
    );
    assert_eq!(
        s.figures.net.amount.parse::<Decimal>().unwrap(),
        Decimal::from(1950)
    );
    assert!(
        s.figures.income.prev_month.is_none(),
        "no history behind it"
    );

    let r = summary_of(
        &pool,
        user_id,
        json!({ "from": "2026-03-31", "to": "2026-04-01" }),
    )
    .await
    .unwrap();
    assert_eq!(r.txn_count, 2);
    assert_eq!(
        r.figures.expenses.amount.parse::<Decimal>().unwrap(),
        Decimal::from(520)
    );
}

/// The trend endpoint returns `months` labels ending at the anchor and
/// puts each month's spending in its own column.
#[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
async fn a_trend_puts_spending_in_its_month(pool: PgPool) {
    let (user_id, account) = seed_user(&pool).await;
    let groceries = category(&pool, user_id, "groceries").await;
    for (day, amount) in [("2026-02-10", -40), ("2026-03-10", -30)] {
        let t = seed_dated(&pool, account, day, amount, "LECLERC").await;
        gripsou_core::testkit::set_category(&pool, user_id, t, Some(groceries)).await;
    }

    let t = trend_of(&pool, user_id, json!({ "anchor": "2026-03", "months": 3 }))
        .await
        .unwrap();
    assert_eq!(t.months, vec!["2026-01", "2026-02", "2026-03"]);
    let series = t
        .series
        .iter()
        .find(|s| matches!(&s.slice, SliceDto::Category { category } if category.id == groceries.to_string()))
        .expect("a groceries series");
    let values: Vec<Decimal> = series.values.iter().map(|v| v.parse().unwrap()).collect();
    assert_eq!(
        values,
        vec![Decimal::ZERO, Decimal::from(40), Decimal::from(30)]
    );
}

/// The seeded "Other" category is rolled into the trend's own Other
/// series, so the legend never shows two slices called Other.
#[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
async fn a_trend_folds_the_other_category_into_other(pool: PgPool) {
    let (user_id, account) = seed_user(&pool).await;
    let other = category(&pool, user_id, "other_expense").await;
    let t = seed_dated(&pool, account, "2026-03-10", -25, "MISC").await;
    gripsou_core::testkit::set_category(&pool, user_id, t, Some(other)).await;

    let t = trend_of(&pool, user_id, json!({ "anchor": "2026-03", "months": 3 }))
        .await
        .unwrap();
    assert_eq!(t.series.len(), 1);
    assert!(matches!(t.series[0].slice, SliceDto::Other));
    let values: Vec<Decimal> = t.series[0]
        .values
        .iter()
        .map(|v| v.parse().unwrap())
        .collect();
    assert_eq!(
        values,
        vec![Decimal::ZERO, Decimal::ZERO, Decimal::from(25)]
    );
}

/// The count endpoint reads the list's own filters: total, uncategorised
/// and the matching sum agree with the seeded rows.
#[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
async fn the_transaction_counts_match_the_seeded_rows(pool: PgPool) {
    let (user_id, account) = seed_user(&pool).await;
    let (_, stranger_account) = seed_user(&pool).await;
    let a = seed_dated(&pool, account, "2026-03-10", -30, "LECLERC").await;
    seed_dated(&pool, account, "2026-03-11", -20, "FNAC").await;
    seed_dated(&pool, stranger_account, "2026-03-11", -999, "FNAC").await;
    let groceries = category(&pool, user_id, "groceries").await;
    gripsou_core::testkit::set_category(&pool, user_id, a, Some(groceries)).await;

    let counts = |params: serde_json::Value| {
        let pool = pool.clone();
        async move {
            crate::transactions::transaction_count_summary(
                State(pool),
                auth(user_id),
                Query(serde_json::from_value(params).unwrap()),
            )
            .await
            .map(|j| j.0)
        }
    };
    let c = counts(json!({})).await.unwrap();
    assert_eq!((c.matching, c.total, c.uncategorized), (2, 2, 1));
    assert_eq!(
        c.matching_total.parse::<Decimal>().unwrap(),
        Decimal::from(-50)
    );

    let c = counts(json!({ "search": "fnac" })).await.unwrap();
    assert_eq!((c.matching, c.total), (1, 2));
    assert_eq!(
        c.matching_total.parse::<Decimal>().unwrap(),
        Decimal::from(-20)
    );

    let err = counts(json!({ "bucket": "sideways" })).await.err().unwrap();
    assert_eq!(err.status(), StatusCode::BAD_REQUEST);
}

/// With no AI provider configured (the default settings), the status
/// says so and still reports the user's review queue.
#[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
async fn the_ai_status_says_not_configured_by_default(pool: PgPool) {
    let (user_id, account) = seed_user(&pool).await;
    let txn = seed_txn(&pool, account, "LECLERC").await;
    ai_guess(&pool, txn, category(&pool, user_id, "groceries").await).await;

    let s = categorize_status(
        State(pool.clone()),
        State(crate::testkit::deps()),
        auth(user_id),
    )
    .await
    .unwrap()
    .0;
    assert!(!s.configured);
    assert!(!s.running);
    assert_eq!(s.review_count, 1);
    assert!(s.last_run.is_none());
}

/// Asking for a run with no AI configured is refused with 409, never
/// queued — nothing could ever pick it up.
#[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
async fn requesting_a_run_without_an_ai_is_409(pool: PgPool) {
    let (user_id, _) = seed_user(&pool).await;
    assert_eq!(
        request_categorize(
            State(pool.clone()),
            State(crate::testkit::deps()),
            auth(user_id)
        )
        .await
        .status(),
        StatusCode::CONFLICT
    );
}

/// `undo_review` answers `Ok(status)` for a refusal decided by the
/// repository and `Err` for one decided by the handler; the tests only
/// care about the status.
trait StatusOf {
    fn status(self) -> StatusCode;
}

impl StatusOf for Result<StatusCode, ApiError> {
    fn status(self) -> StatusCode {
        match self {
            Ok(s) => s,
            Err(e) => e.status(),
        }
    }
}
