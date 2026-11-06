//! `#[db_test]`, used as `gripsou_core::testkit::db_test`.

use proc_macro::TokenStream;
use quote::quote;
use syn::{ItemFn, parse_macro_input};

/// A test on a fresh database (`gripsou_core::testkit::run_db_test`), for an
/// `async fn(PgPool)` returning `()` or a `Result`. Its future is boxed, so
/// every test shares one copy of the harness, where `#[sqlx::test]` compiles
/// one per test.
#[proc_macro_attribute]
pub fn db_test(args: TokenStream, item: TokenStream) -> TokenStream {
    let ItemFn {
        attrs,
        vis,
        sig,
        block,
    } = parse_macro_input!(item as ItemFn);
    if !args.is_empty() || sig.asyncness.is_none() || sig.inputs.len() != 1 {
        return syn::Error::new_spanned(&sig, "#[db_test] takes an `async fn(PgPool)`")
            .to_compile_error()
            .into();
    }
    let name = &sig.ident;
    let inputs = &sig.inputs;
    let output = &sig.output;
    quote! {
        #(#attrs)*
        #[::core::prelude::v1::test]
        #vis fn #name() #output {
            async fn #name(#inputs) #output #block
            ::gripsou_core::testkit::run_db_test(
                concat!(module_path!(), "::", stringify!(#name)),
                |pool| ::std::boxed::Box::pin(#name(pool)),
            )
        }
    }
    .into()
}
