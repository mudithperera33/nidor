import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  fetchAdminProducts,
  fetchPublicFragrances,
  saveAdminProduct,
  type ProductDraft,
  type ProductRecord,
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
  return useMutation(createSaveAdminProductMutationOptions(queryClient));
}

export type AdminProductSaveInput = {
  draft: ProductDraft;
  imageFile?: File;
};

export function createSaveAdminProductMutationOptions(
  queryClient: QueryClient,
  mutationFn: (input: AdminProductSaveInput) => Promise<ProductRecord> = (input) =>
    saveAdminProduct(input.draft, undefined, input.imageFile),
) {
  return {
    mutationFn,
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminCatalogQueryKey }),
        queryClient.invalidateQueries({ queryKey: publicCatalogQueryKey }),
      ]);
    },
  };
}