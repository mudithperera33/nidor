import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchAdminProducts,
  fetchPublicFragrances,
  saveAdminProduct,
  type ProductDraft,
} from '@/lib/product-catalog';

export const publicCatalogQueryKey = ['catalog', 'public'] as const;
export const adminCatalogQueryKey = ['catalog', 'admin'] as const;

export function usePublicCatalog() {
  return useQuery({
    queryKey: publicCatalogQueryKey,
    queryFn: fetchPublicFragrances,
    staleTime: 60_000,
    retry: 1,
  });
}

export function useAdminCatalog(enabled: boolean) {
  return useQuery({
    queryKey: adminCatalogQueryKey,
    queryFn: fetchAdminProducts,
    enabled,
    staleTime: 15_000,
    retry: 1,
  });
}

export function useSaveAdminProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (draft: ProductDraft) => saveAdminProduct(draft),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminCatalogQueryKey }),
        queryClient.invalidateQueries({ queryKey: publicCatalogQueryKey }),
      ]);
    },
  });
}