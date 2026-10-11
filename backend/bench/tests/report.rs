use gripsou_bench::report::statistics;

#[test]
fn nearest_rank_statistics_and_invalid_samples() {
    assert_eq!(statistics(&[5., 1., 3., 2., 4.]).unwrap(), (1., 3., 5., 5.));
    for bad in [vec![], vec![-1.], vec![f64::NAN], vec![f64::INFINITY]] {
        assert!(statistics(&bad).is_err());
    }
    assert_eq!(statistics(&[0.]).unwrap(), (0., 0., 0., 0.));
}

#[test]
fn atomic_artifacts_roundtrip_and_do_not_leave_temporary_files() {
    let dir = std::env::temp_dir().join(format!("bench-atomic-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&dir).unwrap();
    let value = serde_json::json!({"amount":"10","ids":[1,2]});
    let path = dir.join("result.json");
    gripsou_bench::report::write_atomic(&path, &value).unwrap();
    assert_eq!(
        gripsou_bench::report::read::<serde_json::Value>(&path).unwrap(),
        value
    );
    assert!(gripsou_bench::report::write_atomic(&dir, &value).is_err());
    assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
    std::fs::remove_dir_all(dir).unwrap();
}
