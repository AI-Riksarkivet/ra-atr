<script lang="ts">
	import { searchCatalog, type CatalogResult } from '$lib/api';

	interface Props {
		onLoadVolume: (referenceCode: string, metadata?: CatalogResult) => void;
	}

	let { onLoadVolume }: Props = $props();

	let searchQuery = $state('');

	export function setSearch(q: string) {
		searchQuery = q;
		queryCatalog();
	}
	let catalogResults = $state<CatalogResult[]>([]);
	let catalogTotal = $state(0);
	let catalogLoading = $state(false);
	let showCatalog = $state(true);
	let debounceTimer: ReturnType<typeof setTimeout>;

	function onSearchInput() {
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(queryCatalog, 400);
	}

	async function queryCatalog(append = false) {
		const q = searchQuery.trim();
		if (!q && !showCatalog) {
			catalogResults = [];
			catalogTotal = 0;
			return;
		}
		catalogLoading = true;
		try {
			const data = await searchCatalog({
				q: q || undefined,
				mode: 'fts',
				limit: 200,
				offset: append ? catalogResults.length : 0,
			});
			if (append) {
				catalogResults = [...catalogResults, ...data.results];
			} else {
				catalogResults = data.results;
			}
			catalogTotal = data.total;
		} catch {
			if (!append) {
				catalogResults = [];
				catalogTotal = 0;
			}
		} finally {
			catalogLoading = false;
		}
	}

	// Group catalog results into a tree: fonds → series → volumes
	interface CatalogFonds {
		title: string;
		description: string;
		creator: string;
		archiveCode: string;
		series: { title: string; volumes: CatalogResult[] }[];
	}
	let collapsedFonds = $state(new Set<string>());
	let query = $derived(searchQuery.trim());

	function highlight(text: string): { before: string; match: string; after: string }[] {
		if (!query || !text) return [{ before: text, match: '', after: '' }];
		const idx = text.toLowerCase().indexOf(query.toLowerCase());
		if (idx === -1) return [{ before: text, match: '', after: '' }];
		return [
			{
				before: text.slice(0, idx),
				match: text.slice(idx, idx + query.length),
				after: text.slice(idx + query.length),
			},
		];
	}

	let catalogTree = $derived.by(() => {
		const fondsMap = new Map<string, Map<string, CatalogResult[]>>();
		for (const r of catalogResults) {
			const fKey = r.fonds_title || r.reference_code;
			if (!fondsMap.has(fKey)) fondsMap.set(fKey, new Map());
			const seriesMap = fondsMap.get(fKey)!;
			const sKey = r.series_title || '';
			if (!seriesMap.has(sKey)) seriesMap.set(sKey, []);
			seriesMap.get(sKey)!.push(r);
		}
		const tree: CatalogFonds[] = [];
		for (const [fTitle, seriesMap] of fondsMap) {
			const series = [...seriesMap.entries()].map(([title, volumes]) => ({ title, volumes }));
			const first = series[0]?.volumes[0];
			tree.push({
				title: fTitle,
				description: first?.fonds_description ?? '',
				creator: first?.creator ?? '',
				archiveCode: first?.archive_code ?? '',
				series,
			});
		}
		return tree;
	});
</script>

<div class="flex flex-col flex-1 min-h-0 bg-card text-card-foreground font-sans text-xs">
	<!-- Sticky header -->
	<div class="shrink-0 p-3 pb-2 border-b border-border">
		<div class="mb-2">
			<input
				type="text"
				bind:value={searchQuery}
				oninput={onSearchInput}
				placeholder="Search archive catalog..."
				class="w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
			/>
		</div>

		<div class="flex items-center gap-2 px-1">
			{#if catalogLoading}
				<span class="text-[0.65rem] text-muted-foreground animate-pulse ml-auto">Searching...</span>
			{:else if catalogTotal > 0}
				<span class="text-[0.65rem] text-muted-foreground font-mono ml-auto">{catalogTotal}</span>
			{/if}
		</div>
	</div>

	<!-- Scrollable results -->
	<div class="flex-1 overflow-y-auto p-3 pt-2">
		{#snippet hl(text: string)}
			{#each highlight(text) as part, i (i)}{part.before}{#if part.match}<mark
						class="bg-yellow-400/40 text-inherit rounded-sm px-px">{part.match}</mark
					>{/if}{part.after}{/each}
		{/snippet}
		{#each catalogTree as fonds (fonds.title)}
			{@const fCollapsed = collapsedFonds.has(fonds.title)}
			<div
				class="flex items-center gap-2 px-2 py-1.5 rounded select-none mb-0.5 bg-muted/30 cursor-pointer hover:bg-muted/50"
				onclick={() => {
					const next = new Set(collapsedFonds);
					if (next.has(fonds.title)) next.delete(fonds.title);
					else next.add(fonds.title);
					collapsedFonds = next;
				}}
				onkeydown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						const next = new Set(collapsedFonds);
						if (next.has(fonds.title)) next.delete(fonds.title);
						else next.add(fonds.title);
						collapsedFonds = next;
					}
				}}
				role="button"
				tabindex="0"
			>
				<span class="text-[0.65rem] w-4">{fCollapsed ? '\u25B6' : '\u25BC'}</span>
				<span class="font-semibold truncate flex-1">{@render hl(fonds.title)}</span>
				<span class="text-[0.65rem] text-muted-foreground font-mono"
					>{fonds.series.reduce((n, s) => n + s.volumes.length, 0)}</span
				>
			</div>

			{#if !fCollapsed}
				<div class="pl-4 pr-2 pb-1">
					{#if fonds.creator}
						<div class="text-[0.6rem] text-muted-foreground">{@render hl(fonds.creator)}</div>
					{/if}
					{#if fonds.description}
						<div class="text-[0.6rem] text-muted-foreground/70 mt-0.5 line-clamp-3">
							{@render hl(fonds.description)}
						</div>
					{/if}
					<div class="text-[0.55rem] text-muted-foreground/40 font-mono mt-0.5">
						{fonds.archiveCode}
					</div>
				</div>

				<div class="pl-2">
					{#each fonds.series as series (series.title)}
						{#if series.title}
							<div class="text-[0.65rem] text-muted-foreground font-medium px-2 py-0.5 mt-1">
								{@render hl(series.title)}
							</div>
						{/if}
						<div class="pl-2">
							{#each series.volumes as vol (vol.reference_code)}
								<div
									class="flex items-center gap-2 px-2 py-1 rounded mb-0.5 cursor-pointer hover:bg-muted/50"
									onclick={() => onLoadVolume(vol.reference_code, vol)}
									onkeydown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											onLoadVolume(vol.reference_code, vol);
										}
									}}
									role="button"
									tabindex={0}
								>
									<span class="truncate flex-1">
										vol. {vol.volume_id}
										{#if vol.date_text}
											<span class="text-muted-foreground ml-1">({vol.date_text})</span>
										{/if}
									</span>
									<span class="text-[0.55rem] text-primary font-medium">Load</span>
								</div>
								{#if vol.description}
									<div class="text-[0.6rem] text-muted-foreground/60 px-4 pb-0.5">
										{@render hl(vol.description)}
									</div>
								{/if}
								<div class="text-[0.5rem] text-muted-foreground/30 px-4 pb-1 font-mono">
									{vol.reference_code}
								</div>
							{/each}
						</div>
					{/each}
				</div>
			{/if}
		{/each}

		{#if !catalogLoading && catalogResults.length === 0 && (searchQuery.trim() || showCatalog)}
			<p class="text-[0.65rem] text-muted-foreground italic px-1 mt-2">No results</p>
		{/if}

		{#if catalogResults.length > 0 && catalogResults.length < catalogTotal}
			<button
				class="w-full rounded border border-border px-2 py-1.5 mt-2 text-[0.65rem] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
				onclick={() => queryCatalog(true)}
				disabled={catalogLoading}
			>
				{catalogLoading ? 'Loading...' : `Load more (${catalogResults.length} / ${catalogTotal})`}
			</button>
		{/if}
	</div>
</div>
