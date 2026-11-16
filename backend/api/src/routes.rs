//! The API's routes as data, built into the router. Each entry carries the body, query and answer types read off the handler's signature, for `frontend/src/api/routes.ts` and the mock check.

use std::collections::BTreeSet;
use std::future::Future;

use axum::Router;
use axum::extract::{OriginalUri, Path, Query, State};
use axum::handler::Handler;
use axum::http::{HeaderMap, Method, StatusCode};
use axum::routing::{MethodFilter, MethodRouter, on};
use ts_rs::{Config, TS, TypeVisitor};

use crate::AppState;
use crate::auth::client::Client;
use crate::auth::{AdminUser, AuthUser};
use crate::error::{ApiError, Json};
use crate::wire_ts::Types;

struct Route {
    method: Method,
    path: &'static str,
    router: MethodRouter<AppState>,
    types: RouteTypes,
}

#[derive(Default)]
pub(crate) struct Routes(Vec<Route>);

macro_rules! methods {
    ($($name:ident => $method:ident),* $(,)?) => {$(
        pub(crate) fn $name<H, T, A>(self, path: &'static str, handler: H) -> Self
        where
            H: Handler<T, AppState> + Typed<A>,
            T: 'static,
        {
            self.layered(Method::$method, path, handler, |route| route)
        }
    )*};
}

impl Routes {
    methods!(get => GET, post => POST, put => PUT, patch => PATCH, delete => DELETE);

    pub(crate) fn layered<H, T, A>(
        mut self,
        method: Method,
        path: &'static str,
        handler: H,
        layer: impl FnOnce(MethodRouter<AppState>) -> MethodRouter<AppState>,
    ) -> Self
    where
        H: Handler<T, AppState> + Typed<A>,
        T: 'static,
    {
        let filter = MethodFilter::try_from(method.clone()).expect("a standard method");
        self.0.push(Route {
            method,
            path,
            router: layer(on(filter, handler)),
            types: H::types(),
        });
        self
    }

    pub(crate) fn merge(mut self, other: Routes) -> Self {
        self.0.extend(other.0);
        self
    }

    #[cfg(test)]
    pub(crate) fn list(&self) -> impl Iterator<Item = (&Method, &'static str)> {
        self.0.iter().map(|route| (&route.method, route.path))
    }

    pub(crate) fn into_router(self) -> Router<AppState> {
        self.0.into_iter().fold(Router::new(), |router, route| {
            router.route(route.path, route.router)
        })
    }

    pub(crate) fn visit_types(&self, types: &mut Types) {
        for route in &self.0 {
            (route.types.visit)(types);
        }
    }
}

pub(crate) trait Wire {
    const NONE: bool = false;
    fn name(cfg: &Config) -> String;
    fn visit(v: &mut impl TypeVisitor);
}

impl<T: TS + 'static> Wire for T {
    fn name(cfg: &Config) -> String {
        T::name(cfg)
    }
    fn visit(v: &mut impl TypeVisitor) {
        v.visit::<T>();
    }
}

pub(crate) enum Absent {}

impl Wire for Absent {
    const NONE: bool = true;
    fn name(_: &Config) -> String {
        "void".into()
    }
    fn visit(_: &mut impl TypeVisitor) {}
}

pub(crate) enum RawBody {}

impl Wire for RawBody {
    fn name(_: &Config) -> String {
        "unknown".into()
    }
    fn visit(_: &mut impl TypeVisitor) {}
}

/// What a handler argument reads of the request.
pub(crate) trait Arg {
    /// axum reads the body only in the last argument.
    type Body: Wire + 'static;
    type Query: Wire + 'static;
}

impl<T: TS + 'static> Arg for Json<T> {
    type Body = T;
    type Query = Absent;
}

impl Arg for axum::body::Bytes {
    type Body = RawBody;
    type Query = Absent;
}

impl<Q: TS + 'static> Arg for Query<Q> {
    type Body = Absent;
    type Query = Q;
}

macro_rules! reads_nothing {
    ($($ty:ty $(=> $($param:ident),*)?;)*) => {$(
        impl$(<$($param),*>)? Arg for $ty {
            type Body = Absent;
            type Query = Absent;
        }
    )*};
}

reads_nothing! {
    State<S> => S;
    Path<P> => P;
    AuthUser;
    AdminUser;
    Client;
    HeaderMap;
    OriginalUri;
}

pub(crate) trait Reply {
    type Res: Wire + 'static;
}

impl<T: TS + 'static> Reply for Json<T> {
    type Res = T;
}

impl Reply for StatusCode {
    type Res = Absent;
}

impl<R: Reply> Reply for (StatusCode, R) {
    type Res = R::Res;
}

impl<R: Reply, H, const N: usize> Reply for ([H; N], R) {
    type Res = R::Res;
}

impl<R: Reply> Reply for Result<R, ApiError> {
    type Res = R::Res;
}

pub(crate) trait Typed<A> {
    fn types() -> RouteTypes;
}

pub(crate) struct RouteTypes {
    body: fn(&Config) -> Option<String>,
    query: fn(&Config) -> Option<String>,
    res: fn(&Config) -> String,
    visit: fn(&mut Types),
    imports: fn(&mut Imports),
}

fn named<W: Wire>(cfg: &Config) -> Option<String> {
    (!W::NONE).then(|| W::name(cfg))
}

macro_rules! typed {
    ($($arg:ident),*) => {
        impl<F, Fut, $($arg,)*> Typed<($($arg,)*)> for F
        where
            F: FnOnce($($arg),*) -> Fut,
            Fut: Future,
            Fut::Output: Reply,
            $($arg: Arg,)*
        {
            fn types() -> RouteTypes {
                fn query<$($arg: Arg),*>(_cfg: &Config) -> Option<String> {
                    None$(.or_else(|| named::<<$arg as Arg>::Query>(_cfg)))*
                }
                fn visit<$($arg: Arg,)* R: Wire, V: TypeVisitor>(v: &mut V) {
                    <<typed!(@last $($arg),*) as Arg>::Body as Wire>::visit(v);
                    $(<<$arg as Arg>::Query as Wire>::visit(v);)*
                    <R as Wire>::visit(v);
                }
                RouteTypes {
                    body: named::<<typed!(@last $($arg),*) as Arg>::Body>,
                    query: query::<$($arg),*>,
                    res: <<Fut::Output as Reply>::Res as Wire>::name,
                    visit: visit::<$($arg,)* <Fut::Output as Reply>::Res, Types>,
                    imports: visit::<$($arg,)* <Fut::Output as Reply>::Res, Imports>,
                }
            }
        }
    };
    (@last) => { NoArgs };
    (@last $last:ident) => { $last };
    (@last $first:ident, $($rest:ident),+) => { typed!(@last $($rest),+) };
}

/// Stands for the missing last argument of a handler that takes none.
pub(crate) enum NoArgs {}

impl Arg for NoArgs {
    type Body = Absent;
    type Query = Absent;
}

typed!();
typed!(A1);
typed!(A1, A2);
typed!(A1, A2, A3);
typed!(A1, A2, A3, A4);
typed!(A1, A2, A3, A4, A5);
typed!(A1, A2, A3, A4, A5, A6);
typed!(A1, A2, A3, A4, A5, A6, A7);
typed!(A1, A2, A3, A4, A5, A6, A7, A8);

#[derive(Default)]
pub(crate) struct Imports(BTreeSet<String>);

impl TypeVisitor for Imports {
    fn visit<T: TS + 'static + ?Sized>(&mut self) {
        if T::output_path().is_some() {
            self.0.insert(T::ident(&crate::wire_ts::config()));
        } else {
            T::visit_generics(self);
        }
    }
}

pub const PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../frontend/src/api/routes.ts"
);

pub fn render() -> String {
    let cfg = crate::wire_ts::config();
    let routes = crate::api_routes();
    let mut imports = Imports::default();
    let mut entries: Vec<(String, String, &RouteTypes)> = routes
        .0
        .iter()
        .map(|route| {
            (route.types.imports)(&mut imports);
            let path = route
                .path
                .split('/')
                .map(
                    |seg| match seg.strip_prefix('{').and_then(|s| s.strip_suffix('}')) {
                        Some(param) => format!(":{param}"),
                        None => seg.to_string(),
                    },
                )
                .collect::<Vec<_>>()
                .join("/");
            (path, route.method.to_string(), &route.types)
        })
        .collect();
    entries.sort_by(|a, b| (&a.0, &a.1).cmp(&(&b.0, &b.1)));

    let mut out = format!(
        "// Generated by `{}` (backend/api/src/routes.rs). Do not edit.\n\n\
         import type {{\n{}}} from \"./wire\";\n\n\
         /** Every route the server answers under /api. */\n\
         export const ROUTES = [\n",
        crate::wire_ts::COMMAND,
        imports
            .0
            .iter()
            .map(|name| format!("  {name},\n"))
            .collect::<String>(),
    );
    for (path, method, _) in &entries {
        out.push_str(&format!("  \"{method} {path}\",\n"));
    }
    out.push_str(
        "] as const;\n\nexport type Route = (typeof ROUTES)[number];\n\n\
         /** The JSON body and query parameters each route takes (none when\n \
         * absent) and the answer it sends (`void`: none), as its handler\n \
         * declares them. */\n\
         export type Api = {\n",
    );
    for (path, method, types) in &entries {
        let body = (types.body)(&cfg)
            .map(|body| format!("body: {body}; "))
            .unwrap_or_default();
        let query = (types.query)(&cfg)
            .map(|query| format!("query: {query}; "))
            .unwrap_or_default();
        out.push_str(&format!(
            "  \"{method} {path}\": {{ {body}{query}res: {} }};\n",
            (types.res)(&cfg)
        ));
    }
    out.push_str("};\n");
    out
}
