import '@apollo/client';

declare module '@apollo/client' {
  namespace ApolloClient {
    namespace DeclareDefaultOptions {
      interface WatchQuery {
        fetchPolicy?: import('@apollo/client').WatchQueryFetchPolicy;
      }
      interface Query {
        fetchPolicy?: import('@apollo/client').QueryFetchPolicy;
      }
      interface Mutate {
        errorPolicy?: import('@apollo/client').ErrorPolicy;
      }
    }
  }
}
