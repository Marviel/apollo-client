import {
  NetworkInterface,
  createNetworkInterface,
} from './networkInterface';

import {
  GraphQLResult,
  Document,
} from 'graphql';

import {
  print,
} from 'graphql/language/printer';

import {
  createApolloStore,
  ApolloStore,
  createApolloReducer,
  ApolloReducerConfig,
} from './store';

import {
  QueryManager,
  WatchQueryOptions,
  ObservableQuery,
} from './QueryManager';

import {
  readQueryFromStore,
  readFragmentFromStore,
} from './data/readFromStore';

import {
  writeQueryToStore,
  writeFragmentToStore,
} from './data/writeToStore';

import {
  IdGetter,
} from './data/extensions';

import {
  QueryTransformer,
  addTypenameToSelectionSet,
} from './queries/queryTransform';

import {
  MutationBehavior,
  MutationBehaviorReducerMap,
} from './data/mutationResults';

import {
  storeKeyNameFromFieldNameAndArgs,
} from './data/storeUtils';

import isUndefined = require('lodash.isundefined');
import assign = require('lodash.assign');

// We expose the print method from GraphQL so that people that implement
// custom network interfaces can turn query ASTs into query strings as needed.
export {
  createNetworkInterface,
  createApolloStore,
  createApolloReducer,
  readQueryFromStore,
  readFragmentFromStore,
  addTypenameToSelectionSet as addTypename,
  writeQueryToStore,
  writeFragmentToStore,
  printAST: print,
};

export default class ApolloClient {
  public networkInterface: NetworkInterface;
  public store: ApolloStore;
  public reduxRootKey: string;
  public initialState: any;
  public queryManager: QueryManager;
  public reducerConfig: ApolloReducerConfig;
  public queryTransformer: QueryTransformer;
  public shouldBatch: boolean;
  public shouldForceFetch: boolean;
  public dataId: IdGetter;
  public fieldWithArgs: (fieldName: string, args?: Object) => string;

  constructor({
    networkInterface,
    reduxRootKey,
    initialState,
    dataIdFromObject,
    queryTransformer,
    shouldBatch = false,
    ssrMode = false,
    ssrForceFetchDelay = 0,
    mutationBehaviorReducers = {} as MutationBehaviorReducerMap,
  }: {
    networkInterface?: NetworkInterface,
    reduxRootKey?: string,
    initialState?: any,
    dataIdFromObject?: IdGetter,
    queryTransformer?: QueryTransformer,
    shouldBatch?: boolean,
    ssrMode?: boolean,
    ssrForceFetchDelay?: number
    mutationBehaviorReducers?: MutationBehaviorReducerMap,
  } = {}) {
    this.reduxRootKey = reduxRootKey ? reduxRootKey : 'apollo';
    this.initialState = initialState ? initialState : {};
    this.networkInterface = networkInterface ? networkInterface :
      createNetworkInterface('/graphql');
    this.queryTransformer = queryTransformer;
    this.shouldBatch = shouldBatch;
    this.shouldForceFetch = !(ssrMode || ssrForceFetchDelay > 0);
    this.dataId = dataIdFromObject;
    this.fieldWithArgs = storeKeyNameFromFieldNameAndArgs;

    if (ssrForceFetchDelay) {
      setTimeout(() => this.shouldForceFetch = true, ssrForceFetchDelay);
    }

    this.reducerConfig = {
      dataIdFromObject,
      mutationBehaviorReducers,
    };
  }

  public watchQuery = (options: WatchQueryOptions): ObservableQuery => {
    this.initStore();

    if (!this.shouldForceFetch && options.forceFetch) {
      options = assign({}, options, {
        forceFetch: false,
      }) as WatchQueryOptions;
    }

    return this.queryManager.watchQuery(options);
  };

  public query = (options: WatchQueryOptions): Promise<GraphQLResult> => {
    this.initStore();

    if (!this.shouldForceFetch && options.forceFetch) {
      options = assign({}, options, {
        forceFetch: false,
      }) as WatchQueryOptions;
    }

    return this.queryManager.query(options);
  };

  public mutate = (options: {
    mutation: Document,
    resultBehaviors?: MutationBehavior[],
    variables?: Object,
  }): Promise<GraphQLResult> => {
    this.initStore();
    return this.queryManager.mutate(options);
  };

  public reducer(): Function {
    return createApolloReducer(this.reducerConfig);
  }

  public middleware = () => {
    return (store: ApolloStore) => {
      this.setStore(store);

      return (next) => (action) => {
        const returnValue = next(action);
        this.queryManager.broadcastNewStore(store.getState());
        return returnValue;
      };
    };
  };

  public initStore() {
    if (this.store) {
      // Don't do anything if we already have a store
      return;
    }

    // If we don't have a store already, initialize a default one
    this.setStore(createApolloStore({
      reduxRootKey: this.reduxRootKey,
      initialState: this.initialState,
      config: this.reducerConfig,
    }));
  };

  private setStore = (store: ApolloStore) => {
    // ensure existing store has apolloReducer
    if (isUndefined(store.getState()[this.reduxRootKey])) {
      throw new Error(`Existing store does not use apolloReducer for ${this.reduxRootKey}`);
    }

    this.store = store;

    this.queryManager = new QueryManager({
      networkInterface: this.networkInterface,
      reduxRootKey: this.reduxRootKey,
      store,
      queryTransformer: this.queryTransformer,
      shouldBatch: this.shouldBatch,
    });
  };
}
