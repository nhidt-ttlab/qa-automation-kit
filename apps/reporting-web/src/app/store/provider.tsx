/**
 * MobX Store Provider and Hook
 */

import React, { createContext, useContext } from 'react';
import { getRootStore, type RootStore } from './RootStore';

const StoreContext = createContext<RootStore | null>(null);

export interface StoreProviderProps {
  children: React.ReactNode;
  store?: RootStore;
}

export function StoreProvider({ children, store }: StoreProviderProps) {
  const rootStore = store || getRootStore();

  return (
    <StoreContext.Provider value={rootStore}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore(): RootStore {
  const store = useContext(StoreContext);
  if (!store) {
    throw new Error('useStore must be used within a StoreProvider');
  }
  return store;
}

// Feature-specific hooks
export function useRunDetailStore() {
  return useStore().runDetailStore;
}

export function useTestCaseListStore() {
  return useStore().testCaseListStore;
}

export function useTestCaseDetailStore() {
  return useStore().testCaseDetailStore;
}

export function useDefectStore() {
  return useStore().defectStore;
}

export function useResolutionQueueStore() {
  return useStore().resolutionQueueStore;
}

export function useReviewStore() {
  return useStore().reviewStore;
}

export function useDashboardStore() {
  return useStore().dashboardStore;
}

export function useSearchStore() {
  return useStore().searchStore;
}

export function useRedmineStore() {
  return useStore().redmineStore;
}

export function useRegressionRunStore() {
  return useStore().regressionRunStore;
}

export function useFeatureDomainOptionsStore() {
  return useStore().featureDomainOptionsStore;
}
