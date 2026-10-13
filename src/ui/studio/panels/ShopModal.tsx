/**
 * "Find real products" (store.shop): AI search of The Home Depot, Lowe's and
 * reputable nurseries for real product pages, filtered by category, stores,
 * max price and the project's hardiness zone. Results go to the idea board
 * ("Add to idea board") or open at the store. Mounted once by the app shell.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Check, ExternalLink, ImageOff, MapPin, Plus, Search, ShoppingBag } from 'lucide-react';
import { create } from 'zustand';
import type { ProductResult, ProductSearchResult } from '../../../../shared/api';
import { ASSET_CATEGORIES, type AssetCategory, type StoreKind } from '../../../../shared/types';
import { fetchProductImage, searchProducts } from '../../../lib/products';
import { locationForApi } from '../../../lib/studio';
import { useStore, type ShopRequest } from '../../../state/store';
import { errorText } from '../../shell/format';
import { openSettings } from '../../shell/shellUI';
import { Badge, Button, Field, Modal, NumberInput, Select, TextInput, cn } from '../../common';
import { runAiJob } from './aiJobs';
import { addProductIdea } from './ideas';
import { CATEGORY_LABELS, SHOP_STORES, priceLabel, storeLabel, zoneFit } from './productInfo';
import { AiJobStatus, AiUnavailableNote, Chip, useAiReady } from './ui';

const SEARCH_JOB = 'shop-search';

/** Last results of this session (kept while the modal is closed). */
const useShopResults = create<{ query: string; category: AssetCategory; result: ProductSearchResult | null }>()(() => ({
  query: '',
  category: 'plant',
  result: null,
}));

export function ShopModal() {
  const shop = useStore((s) => s.shop);
  const inProject = useStore((s) => !!s.project);
  const close = () => useStore.getState().closeShop();
  useEffect(() => {
    if (shop && !inProject) useStore.getState().closeShop();
  }, [shop, inProject]);
  return (
    <Modal open={!!shop && inProject} onClose={close} title="Find real products" size="xl">
      {shop && <ShopBody key={`${shop.query}|${shop.category}`} request={shop} />}
    </Modal>
  );
}

function defaultStores(category: AssetCategory): StoreKind[] {
  return category === 'plant' ? ['home-depot', 'lowes', 'nursery'] : ['home-depot', 'lowes'];
}

function ShopBody({ request }: { request: ShopRequest }) {
  const location = useStore((s) => s.project?.location);
  const aiReady = useAiReady();
  const last = useShopResults();
  const [query, setQuery] = useState(request.query || (last.result ? last.query : ''));
  const [category, setCategory] = useState<AssetCategory>(request.query ? request.category : last.result ? last.category : request.category);
  const [stores, setStores] = useState<StoreKind[]>(() => defaultStores(request.category));
  const [maxPrice, setMaxPrice] = useState<number | undefined>(undefined);
  const [context, setContext] = useState('');
  const zone = location?.climate?.hardinessZone?.trim() || location?.hardinessZone?.trim() || null;
  const canSearch = query.trim().length >= 2 && stores.length > 0 && aiReady;

  const search = (e?: FormEvent) => {
    e?.preventDefault();
    if (!canSearch) return;
    const q = query.trim();
    void runAiJob(
      SEARCH_JOB,
      async (signal) => {
        const result = await searchProducts(
          {
            query: q.slice(0, 300),
            category,
            stores,
            maxPriceUsd: maxPrice !== undefined && Number.isFinite(maxPrice) && maxPrice > 0 ? maxPrice : null,
            location: locationForApi(location),
            context: context.trim() ? context.trim().slice(0, 1000) : null,
          },
          signal,
        );
        if (!signal.aborted) useShopResults.setState({ query: q, category, result });
        return result;
      },
      { label: `Searching for “${q}”…`, what: 'search the stores' },
    );
  };

  const result = last.result;

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={search} className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
            <TextInput
              autoFocus
              value={query}
              maxLength={300}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={category === 'plant' ? 'e.g. compact hydrangea for a part-sun bed' : 'e.g. black outdoor wall lantern, 18 in'}
              aria-label="What are you looking for?"
              className="h-10 pl-9"
            />
          </div>
          <Select
            value={category}
            onChange={(e) => {
              const c = e.target.value as AssetCategory;
              setCategory(c);
              setStores(defaultStores(c));
            }}
            aria-label="Category"
            className="h-10 sm:w-40"
          >
            {ASSET_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">Stores</span>
            <div className="flex flex-wrap gap-1.5">
              {SHOP_STORES.map((s) => (
                <Chip
                  key={s.kind}
                  pressed={stores.includes(s.kind)}
                  onClick={() => setStores((cur) => (cur.includes(s.kind) ? cur.filter((x) => x !== s.kind) : [...cur, s.kind]))}
                >
                  {s.label}
                </Chip>
              ))}
            </div>
          </div>
          <Field label="Max price" className="w-32">
            <NumberInput value={maxPrice} onValueChange={setMaxPrice} min={0} step={1} placeholder="Any" suffix="USD" />
          </Field>
          <Field label="Where it goes (optional)" className="min-w-48 flex-1">
            <TextInput value={context} maxLength={1000} onChange={(e) => setContext(e.target.value)} placeholder="e.g. north-facing bed by the steps" />
          </Field>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <MapPin className="size-3.5" aria-hidden />
            {zone ? (
              <>Plants are matched to your hardiness zone {zone}.</>
            ) : (
              <>
                No hardiness zone yet —{' '}
                <button type="button" onClick={() => openSettings('project')} className="font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent">
                  add your ZIP
                </button>{' '}
                for plants that fit your climate.
              </>
            )}
          </p>
          <Button type="submit" variant="primary" icon={<Search className="size-4" />} disabled={!canSearch}>
            Search stores
          </Button>
        </div>
        {stores.length === 0 && <p className="text-xs text-danger">Pick at least one store.</p>}
      </form>

      <AiUnavailableNote feature="Product search" />
      {!aiReady && <p className="text-xs text-muted">Without AI you can still paste a product link on the Ideas tab — Mode reads the store page directly.</p>}
      <AiJobStatus jobKey={SEARCH_JOB} hint="Looking through real product pages at the stores you picked. Usually 30–90 seconds." onRetry={() => search()} />

      {result && (
        <section aria-label="Results" className="flex flex-col gap-3">
          <p className="text-xs text-muted">
            {result.products.length === 0
              ? `No products found for “${last.query}”. Try fewer words, another category or more stores.`
              : `${result.products.length} product${result.products.length === 1 ? '' : 's'} for “${last.query}”`}
          </p>
          {result.products.length > 0 && (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {result.products.map((p) => (
                <ProductCard key={p.url} product={p} zone={zone} />
              ))}
            </ul>
          )}
          {result.notes.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-subtle">
              {result.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-subtle">Prices and stock change — always confirm at the store.</p>
        </section>
      )}

      {!result && aiReady && (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <ShoppingBag className="size-6 text-subtle" aria-hidden />
          <p className="max-w-sm text-sm text-muted">Search real products you could actually buy. Add the ones you like to your idea board — Mode then uses them in your designs.</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Product photo: straight from the store (no referrer), else through the server's image proxy. */
function ProductImage({ url, alt }: { url: string | null; alt: string }) {
  const [src, setSrc] = useState<string | null>(url);
  const [failed, setFailed] = useState(!url);
  const [proxied, setProxied] = useState(false);

  useEffect(() => {
    if (!src?.startsWith('blob:')) return;
    return () => URL.revokeObjectURL(src);
  }, [src]);

  const onError = () => {
    if (!url || proxied) {
      setFailed(true);
      return;
    }
    setProxied(true);
    fetchProductImage(url)
      .then((blob) => setSrc(URL.createObjectURL(blob)))
      .catch(() => setFailed(true));
  };

  if (failed || !src) {
    return (
      <div className="flex size-full items-center justify-center text-subtle" role="img" aria-label={`${alt} (no image)`}>
        <ImageOff className="size-6" aria-hidden />
      </div>
    );
  }
  return <img src={src} alt={alt} referrerPolicy="no-referrer" loading="lazy" onError={onError} className="block size-full object-contain p-2" />;
}

function ProductCard({ product, zone }: { product: ProductResult; zone: string | null }) {
  const board = useStore((s) => s.project?.ideaBoard);
  const onBoard = useMemo(() => !!board?.some((i) => i.product?.url === product.url), [board, product.url]);
  const [busy, setBusy] = useState(false);
  const price = priceLabel(product);
  const fit = product.plant ? zoneFit(product.plant.zones, zone) : null;

  const add = async () => {
    setBusy(true);
    try {
      const id = await addProductIdea(product, []);
      if (id) useStore.getState().notify(`Added “${product.name}” to your idea board.`, 'success');
    } catch (err) {
      useStore.getState().notify(`Couldn't add it: ${errorText(err)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="aspect-[4/3] w-full bg-white">
        <ProductImage url={product.imageUrl} alt={product.name} />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="accent">{storeLabel(product)}</Badge>
          {product.brand && <span className="truncate text-[11px] text-muted">{product.brand}</span>}
        </div>
        <p className="line-clamp-2 text-sm font-medium leading-snug text-text">{product.name}</p>
        <p className={cn('text-sm font-semibold', price ? 'text-text' : 'text-subtle')}>{price ?? 'Price not listed'}</p>
        {fit && (
          <span
            className={cn(
              'self-start rounded-full px-2 py-0.5 text-[11px] font-medium',
              fit.kind === 'fits' ? 'bg-success/15 text-success' : fit.kind === 'outside' ? 'bg-danger-soft text-danger' : 'bg-surface-2 text-muted',
            )}
          >
            {fit.text}
          </span>
        )}
        {product.description && <p className="line-clamp-2 text-xs text-muted">{product.description}</p>}
        {product.specs.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {product.specs.slice(0, 4).map((s) => (
              <span key={s} className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">
                {s}
              </span>
            ))}
          </div>
        )}
        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          <Button
            size="sm"
            variant={onBoard ? 'ghost' : 'primary'}
            disabled={onBoard}
            loading={busy}
            icon={onBoard ? <Check className="size-3.5 max-lg:h-9" /> : <Plus className="size-3.5" />}
            onClick={() => void add()}
          >
            {onBoard ? 'On your board' : 'Add to idea board'}
          </Button>
          <a
            href={product.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-text hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent"
          >
            Open at store <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </div>
      </div>
    </li>
  );
}
