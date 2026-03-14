<script lang="ts">
  import type { ImageDocument } from '$lib/types';
  import { searchCatalog, type CatalogResult } from '$lib/api';

  interface Props {
    documents: ImageDocument[];
    activeDocumentId: string | null;
    onSwitchDocument: (id: string) => void;
    hoveredLine: number;
    onHoverLine: (index: number) => void;
    selectedLines: Set<number>;
    onSelectLine: (index: number, additive: boolean) => void;
    onToggleGroup: (groupId: string) => void;
    onRenameGroup: (groupId: string, name: string) => void;
    onDeleteGroup: (groupId: string) => void;
    onFocusGroup: (lineIndices: number[], rect?: { x: number; y: number; w: number; h: number }) => void;
    onFocusLine: (index: number) => void;
    onEditLine: (index: number, text: string) => void;
    onLoadVolume: (referenceCode: string) => void;
    selectMode: boolean;
    activeRegions: Set<string>;
    activeImageIds: Set<string>;
  }

  let {
    documents, activeDocumentId, onSwitchDocument,
    hoveredLine, onHoverLine,
    selectedLines, onSelectLine,
    onToggleGroup, onRenameGroup, onDeleteGroup, onFocusGroup, onFocusLine, onEditLine,
    onLoadVolume,
    selectMode, activeRegions, activeImageIds,
  }: Props = $props();

  let panelEl: HTMLDivElement;
  let editingGroupId = $state<string | null>(null);
  let editName = $state('');
  let editingLineIdx = $state<number>(-1);
  let editLineText = $state('');

  function startRename(group: { id: string; name: string }) {
    editingGroupId = group.id;
    editName = group.name;
  }

  function finishRename(groupId: string) {
    if (editName.trim()) {
      onRenameGroup(groupId, editName.trim());
    }
    editingGroupId = null;
  }

  function startEditLine(idx: number) {
    editingLineIdx = idx;
    const doc = documents.find(d => d.id === activeDocumentId);
    editLineText = doc?.lines[idx]?.text ?? '';
  }

  function finishEditLine() {
    if (editingLineIdx >= 0) {
      onEditLine(editingLineIdx, editLineText);
      editingLineIdx = -1;
    }
  }

  function handleLineClick(i: number, e: MouseEvent) {
    if (selectMode) {
      onSelectLine(i, e.shiftKey || e.ctrlKey || e.metaKey);
    } else {
      onFocusLine(i);
    }
  }

  let copiedGroupId = $state<string | null>(null);

  async function copyGroupLines(group: { id: string; lineIndices: number[]; rect?: { x: number; y: number; w: number; h: number } }) {
    const doc = documents.find(d => d.id === activeDocumentId);
    if (!doc) return;

    const text = group.lineIndices
      .map(i => doc.lines[i]?.text ?? '')
      .filter(t => t.trim())
      .join('\n');

    const items: Record<string, Blob> = {
      'text/plain': new Blob([text], { type: 'text/plain' }),
    };

    // Include image cutout if available
    if (doc.imageUrl && group.rect) {
      try {
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = reject;
          img.src = doc.imageUrl!;
        });
        const r = group.rect;
        const canvas = document.createElement('canvas');
        canvas.width = r.w;
        canvas.height = r.h;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
        const blob = await new Promise<Blob>((resolve) =>
          canvas.toBlob(b => resolve(b!), 'image/png')
        );
        items['image/png'] = blob;
      } catch { /* fall back to text-only */ }
    }

    await navigator.clipboard.write([new ClipboardItem(items)]);
    copiedGroupId = group.id;
    setTimeout(() => { if (copiedGroupId === group.id) copiedGroupId = null; }, 1500);
  }

  const GROUP_COLORS = ['#8b5cf6', '#06b6d4', '#f59e0b', '#ec4899', '#10b981', '#f97316'];

  // Unified search: filters workspace tree + queries catalog
  let searchQuery = $state('');
  let filter = $derived(searchQuery.trim().toLowerCase());
  let catalogResults = $state<CatalogResult[]>([]);
  let catalogTotal = $state(0);
  let catalogLoading = $state(false);
  let digitizedOnly = $state(true);
  let debounceTimer: ReturnType<typeof setTimeout>;

  let showCatalog = $state(false);

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
        limit: 50,
        offset: append ? catalogResults.length : 0,
        digitized: digitizedOnly ? true : undefined,
      });
      if (append) {
        catalogResults = [...catalogResults, ...data.results];
      } else {
        catalogResults = data.results;
      }
      catalogTotal = data.total;
    } catch {
      if (!append) { catalogResults = []; catalogTotal = 0; }
    } finally {
      catalogLoading = false;
    }
  }

  function toggleCatalog() {
    showCatalog = !showCatalog;
    if (showCatalog) queryCatalog();
    else { catalogResults = []; catalogTotal = 0; }
  }

  // Group catalog results into a tree: fonds → series → volumes
  interface CatalogFonds {
    title: string;
    description: string;
    creator: string;
    archiveCode: string;
    series: { title: string; volumes: CatalogResult[] }[];
  }
  let collapsedCatalogFonds = $state(new Set<string>());

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

  $effect(() => {
    digitizedOnly;
    if (searchQuery.trim() || showCatalog) {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(queryCatalog, 100);
    }
  });

  function lineMatches(doc: ImageDocument, lineIdx: number): boolean {
    if (!filter) return true;
    return doc.lines[lineIdx]?.text?.toLowerCase().includes(filter) ?? false;
  }

  function groupHasMatches(doc: ImageDocument, lineIndices: number[]): boolean {
    if (!filter) return true;
    return lineIndices.some(i => lineMatches(doc, i));
  }

  function docHasMatches(doc: ImageDocument): boolean {
    if (!filter) return true;
    return doc.lines.some((l) => l.text?.toLowerCase().includes(filter));
  }

  // Collapsed state for volumes, pages, groups
  let collapsedVolumes = $state(new Set<string>());
  let collapsedDocs = $state(new Set<string>());

  function toggleVolume(id: string) {
    const next = new Set(collapsedVolumes);
    if (next.has(id)) next.delete(id); else next.add(id);
    collapsedVolumes = next;
  }

  function toggleDoc(docId: string) {
    const next = new Set(collapsedDocs);
    if (next.has(docId)) next.delete(docId); else next.add(docId);
    collapsedDocs = next;
  }

  // Group documents: volumes (by manifestId) and standalone uploads
  interface Volume {
    manifestId: string;
    docs: ImageDocument[];
  }

  let volumes = $derived.by(() => {
    const vols = new Map<string, ImageDocument[]>();
    const standalone: ImageDocument[] = [];
    for (const doc of documents) {
      if (doc.manifestId) {
        const list = vols.get(doc.manifestId);
        if (list) list.push(doc); else vols.set(doc.manifestId, [doc]);
      } else {
        standalone.push(doc);
      }
    }
    return {
      volumes: [...vols.entries()].map(([manifestId, docs]) => ({ manifestId, docs })) as Volume[],
      standalone,
    };
  });
</script>

<div class="overflow-y-auto p-3 font-serif text-[0.95rem] leading-relaxed h-full bg-card text-card-foreground" bind:this={panelEl}>

  <!-- Search -->
  <div class="mb-3">
    <input
      type="text"
      bind:value={searchQuery}
      oninput={onSearchInput}
      placeholder="Search workspace & catalog..."
      class="w-full rounded border border-border bg-background px-2 py-1.5 text-xs font-sans text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
    />
  </div>

  <!-- Volumes (Riksarkivet) -->
  {#each volumes.volumes as vol}
    {@const volHasMatches = !filter || vol.docs.some(d => docHasMatches(d))}
    {#if volHasMatches}
    {@const volCollapsed = collapsedVolumes.has(vol.manifestId)}
    {@const volLines = vol.docs.reduce((n, d) => n + d.lines.length, 0)}
    {@const volCompleted = vol.docs.reduce((n, d) => n + d.lines.filter(l => l.complete).length, 0)}
    {@const volWorking = vol.docs.some(d => activeImageIds.has(d.id))}

    <!-- Volume header -->
    <div
      class="flex items-center gap-2 px-2 py-1.5 rounded select-none font-sans text-xs mb-0.5 bg-muted/30 cursor-pointer hover:bg-muted/50"
      onclick={() => toggleVolume(vol.manifestId)}
    >
      <button class="bg-transparent border-none text-current cursor-pointer p-0 text-[0.65rem] w-4">
        {volCollapsed ? '\u25B6' : '\u25BC'}
      </button>
      {#if volWorking}
        <span class="inline-block size-2 rounded-full bg-orange-500 animate-pulse"></span>
      {/if}
      <span class="font-semibold truncate flex-1">{vol.manifestId}</span>
      <span class="text-[0.65rem] text-muted-foreground font-mono">{vol.docs.length} pg</span>
      {#if volLines > 0}
        <span class="text-[0.7rem] font-mono">{volCompleted}/{volLines}</span>
      {/if}
    </div>

    {#if !volCollapsed}
      <div class="pl-2">
        {#each vol.docs as doc}
          {#if !filter || docHasMatches(doc)}
          {@const isActive = doc.id === activeDocumentId}
          {@const isCollapsed = collapsedDocs.has(doc.id)}
          {@const isWorking = activeImageIds.has(doc.id)}
          {@const totalLines = doc.lines.length}
          {@const completedLines = doc.lines.filter(l => l.complete).length}

          <!-- Page header -->
          <div
            class="flex items-center gap-2 px-2 py-1 rounded cursor-pointer select-none font-sans text-xs mb-0.5 {isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/50'}"
            onclick={() => { onSwitchDocument(doc.id); if (isCollapsed) toggleDoc(doc.id); }}
          >
            <button class="bg-transparent border-none text-current cursor-pointer p-0 text-[0.65rem] w-4" onclick={(e) => { e.stopPropagation(); toggleDoc(doc.id); }}>
              {isCollapsed ? '\u25B6' : '\u25BC'}
            </button>
            {#if isWorking}
              <span class="inline-block size-2 rounded-full bg-orange-500 animate-pulse"></span>
            {/if}
            <span class="truncate flex-1">p. {doc.pageNumber ?? '?'}</span>
            {#if totalLines > 0}
              <span class="text-[0.7rem] font-mono">{completedLines}/{totalLines}</span>
            {/if}
          </div>

          <!-- Page content -->
          {#if !isCollapsed && isActive}
            {@const ungroupedIndices = (() => {
              const grouped = new Set<number>();
              for (const g of doc.groups) for (const idx of g.lineIndices) grouped.add(idx);
              return Array.from({ length: doc.lines.length }, (_, i) => i).filter(i => !grouped.has(i));
            })()}

            <div class="pl-3">
              {#each doc.groups as group, gi}
                {#if !filter || groupHasMatches(doc, group.lineIndices)}
                  {@const groupWorking = group.regionId ? activeRegions.has(group.regionId) : false}
                  {@render groupBlock(doc, group, gi, groupWorking)}
                {/if}
              {/each}

              {#if ungroupedIndices.length > 0}
                {#if doc.groups.length > 0}
                  <div class="text-xs text-muted-foreground font-sans pt-2 px-2 pb-0.5 uppercase tracking-wide">Ungrouped</div>
                {/if}
                {#each ungroupedIndices as lineIdx}
                  {@render lineRow(doc, lineIdx)}
                {/each}
              {/if}

              {#if !filter && doc.lines.length === 0 && doc.groups.length === 0}
                <p class="text-muted-foreground italic text-center text-sm mt-2 mb-2">Draw regions to detect text lines</p>
              {/if}
            </div>
          {:else if !isCollapsed}
            <div class="pl-6 pb-1">
              {#if doc.lines.length === 0 && doc.groups.length === 0}
                <p class="text-muted-foreground italic text-xs">No regions detected</p>
              {:else}
                <p class="text-muted-foreground text-xs">{doc.groups.length} group{doc.groups.length !== 1 ? 's' : ''}, {doc.lines.length} line{doc.lines.length !== 1 ? 's' : ''}</p>
              {/if}
            </div>
          {/if}
          {/if}
        {/each}
      </div>
    {/if}
    {/if}
  {/each}

  <!-- Standalone uploads (no manifest) -->
  {#each volumes.standalone as doc}
    {#if !filter || docHasMatches(doc)}
    {@const isActive = doc.id === activeDocumentId}
    {@const isCollapsed = collapsedDocs.has(doc.id)}
    {@const isWorking = activeImageIds.has(doc.id)}
    {@const totalLines = doc.lines.length}
    {@const completedLines = doc.lines.filter(l => l.complete).length}

    <div
      class="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer select-none font-sans text-xs mb-1 {isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/50'}"
      onclick={() => { onSwitchDocument(doc.id); if (isCollapsed) toggleDoc(doc.id); }}
    >
      <button class="bg-transparent border-none text-current cursor-pointer p-0 text-[0.65rem] w-4" onclick={(e) => { e.stopPropagation(); toggleDoc(doc.id); }}>
        {isCollapsed ? '\u25B6' : '\u25BC'}
      </button>
      {#if isWorking}
        <span class="inline-block size-2 rounded-full bg-orange-500 animate-pulse"></span>
      {/if}
      <span class="font-semibold truncate flex-1">{doc.name}</span>
      {#if totalLines > 0}
        <span class="text-[0.7rem] font-mono">{completedLines}/{totalLines}</span>
      {/if}
    </div>

    {#if !isCollapsed && isActive}
      {@const ungroupedIndices = (() => {
        const grouped = new Set<number>();
        for (const g of doc.groups) for (const idx of g.lineIndices) grouped.add(idx);
        return Array.from({ length: doc.lines.length }, (_, i) => i).filter(i => !grouped.has(i));
      })()}

      <div class="pl-2">
        {#each doc.groups as group, gi}
          {#if !filter || groupHasMatches(doc, group.lineIndices)}
            {@const groupWorking = group.regionId ? activeRegions.has(group.regionId) : false}
            {@render groupBlock(doc, group, gi, groupWorking)}
          {/if}
        {/each}

        {#if ungroupedIndices.length > 0}
          {#if doc.groups.length > 0}
            <div class="text-xs text-muted-foreground font-sans pt-2 px-2 pb-0.5 uppercase tracking-wide">Ungrouped</div>
          {/if}
          {#each ungroupedIndices as lineIdx}
            {@render lineRow(doc, lineIdx)}
          {/each}
        {/if}

        {#if !filter && doc.lines.length === 0 && doc.groups.length === 0}
          <p class="text-muted-foreground italic text-center text-sm mt-4">Draw regions to detect text lines</p>
        {/if}
      </div>
    {:else if !isCollapsed}
      <div class="pl-6 pb-2">
        {#if doc.lines.length === 0 && doc.groups.length === 0}
          <p class="text-muted-foreground italic text-xs">No regions detected</p>
        {:else}
          <p class="text-muted-foreground text-xs">{doc.groups.length} group{doc.groups.length !== 1 ? 's' : ''}, {doc.lines.length} line{doc.lines.length !== 1 ? 's' : ''}</p>
        {/if}
      </div>
    {/if}
    {/if}
  {/each}

  {#if documents.length === 0 && !filter && !showCatalog}
    <button
      class="w-full rounded border border-border px-3 py-2 text-xs font-sans text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors mt-4"
      onclick={toggleCatalog}
    >
      Browse digitized volumes
    </button>
  {/if}

  <!-- Catalog results -->
  {#if filter || showCatalog}
    <div class="mt-3 border-t border-border pt-3">
      <div class="text-[0.65rem] text-muted-foreground font-sans uppercase tracking-wide mb-1.5 px-1 flex items-center gap-2">
        Archive catalog
        {#if catalogLoading}
          <span class="animate-pulse">...</span>
        {/if}
        <label class="ml-auto flex items-center gap-1 cursor-pointer select-none normal-case">
          <input type="checkbox" bind:checked={digitizedOnly} class="accent-primary" />
          digitized
        </label>
        {#if catalogTotal > 0}
          <span class="font-mono normal-case">{catalogTotal}</span>
        {/if}
      </div>
      {#each catalogTree as fonds}
        {@const fCollapsed = collapsedCatalogFonds.has(fonds.title)}
        <!-- Fonds header -->
        <div
          class="flex items-center gap-2 px-2 py-1.5 rounded select-none font-sans text-xs mb-0.5 bg-muted/30 cursor-pointer hover:bg-muted/50"
          onclick={() => {
            const next = new Set(collapsedCatalogFonds);
            if (next.has(fonds.title)) next.delete(fonds.title); else next.add(fonds.title);
            collapsedCatalogFonds = next;
          }}
        >
          <span class="text-[0.65rem] w-4">{fCollapsed ? '\u25B6' : '\u25BC'}</span>
          <span class="font-semibold truncate flex-1">{fonds.title}</span>
          <span class="text-[0.65rem] text-muted-foreground font-mono">{fonds.series.reduce((n, s) => n + s.volumes.length, 0)}</span>
        </div>

        {#if !fCollapsed}
          <!-- Fonds info -->
          <div class="pl-4 pr-2 pb-1">
            {#if fonds.creator}
              <div class="text-[0.6rem] text-muted-foreground font-sans">{fonds.creator}</div>
            {/if}
            {#if fonds.description}
              <div class="text-[0.6rem] text-muted-foreground/70 font-sans mt-0.5 line-clamp-3">{fonds.description}</div>
            {/if}
            <div class="text-[0.55rem] text-muted-foreground/40 font-mono mt-0.5">{fonds.archiveCode}</div>
          </div>

          <div class="pl-2">
            {#each fonds.series as series}
              {#if series.title}
                <div class="text-[0.65rem] text-muted-foreground font-sans font-medium px-2 py-0.5 mt-1">{series.title}</div>
              {/if}
              <div class="pl-2">
                {#each series.volumes as vol}
                  <div
                    class="flex items-center gap-2 px-2 py-1 rounded text-xs font-sans mb-0.5 {vol.digitized ? 'cursor-pointer hover:bg-muted/50' : 'opacity-40'}"
                    onclick={() => { if (vol.digitized) onLoadVolume(vol.reference_code); }}
                  >
                    <span class="truncate flex-1">
                      vol. {vol.volume_id}
                      {#if vol.date_text}
                        <span class="text-muted-foreground ml-1">({vol.date_text})</span>
                      {/if}
                    </span>
                    {#if vol.digitized}
                      <span class="text-[0.55rem] text-primary font-medium">Load</span>
                    {/if}
                  </div>
                  {#if vol.description}
                    <div class="text-[0.6rem] text-muted-foreground/60 px-4 pb-0.5">{vol.description}</div>
                  {/if}
                  <div class="text-[0.5rem] text-muted-foreground/30 px-4 pb-1 font-mono">{vol.reference_code}</div>
                {/each}
              </div>
            {/each}
          </div>
        {/if}
      {/each}
      {#if !catalogLoading && catalogResults.length === 0 && (filter || showCatalog)}
        <p class="text-[0.65rem] text-muted-foreground italic px-1">No catalog results</p>
      {/if}
      {#if catalogResults.length > 0 && catalogResults.length < catalogTotal}
        <button
          class="w-full rounded border border-border px-2 py-1.5 mt-2 text-[0.65rem] font-sans text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          onclick={() => queryCatalog(true)}
          disabled={catalogLoading}
        >
          {catalogLoading ? 'Loading...' : `Load more (${catalogResults.length} / ${catalogTotal})`}
        </button>
      {/if}
    </div>
  {/if}
</div>

<!-- Shared snippets -->

{#snippet groupBlock(doc: ImageDocument, group: import('$lib/types').LineGroup, gi: number, groupWorking: boolean)}
  <div class="mb-2 border-l-3 rounded" style="border-color: {GROUP_COLORS[gi % GROUP_COLORS.length]}">
    <div
      class="flex items-center gap-1.5 px-2 py-1.5 bg-muted/30 text-xs font-sans select-none cursor-pointer"
      onclick={() => onFocusGroup(group.lineIndices, group.rect)}
    >
      <button class="bg-transparent border-none text-muted-foreground cursor-pointer p-0 text-[0.65rem] w-4" onclick={(e) => { e.stopPropagation(); onToggleGroup(group.id); }}>
        {group.collapsed ? '\u25B6' : '\u25BC'}
      </button>
      {#if groupWorking}
        <span class="inline-block size-2 rounded-full bg-orange-500 animate-pulse"></span>
      {/if}
      {#if editingGroupId === group.id}
        <input
          class="bg-card border border-current text-foreground rounded px-1 py-0.5 text-xs w-32 outline-none"
          style="border-color: {GROUP_COLORS[gi % GROUP_COLORS.length]}"
          bind:value={editName}
          onkeydown={(e) => { if (e.key === 'Enter') finishRename(group.id); if (e.key === 'Escape') editingGroupId = null; }}
          onblur={() => finishRename(group.id)}
        />
      {:else}
        <span class="font-semibold cursor-default" style="color: {GROUP_COLORS[gi % GROUP_COLORS.length]}" ondblclick={() => startRename(group)}>{group.name}</span>
      {/if}
      <span class="text-[0.7rem] text-muted-foreground ml-auto">{group.lineIndices.length}</span>
      <button class="bg-transparent border-none text-muted-foreground cursor-pointer px-0.5 text-xs opacity-50 hover:opacity-100" onclick={(e) => { e.stopPropagation(); copyGroupLines(group); }} title="Copy all lines">{copiedGroupId === group.id ? '\u2713' : '\u2398'}</button>
      <button class="bg-transparent border-none text-muted-foreground cursor-pointer px-0.5 text-xs opacity-50 hover:opacity-100" onclick={(e) => { e.stopPropagation(); onFocusGroup(group.lineIndices, group.rect); }} title="Zoom to group">&#x2316;</button>
      <button class="bg-transparent border-none text-muted-foreground cursor-pointer px-0.5 text-xs opacity-50 hover:opacity-100 hover:text-destructive disabled:opacity-20 disabled:cursor-not-allowed" onclick={(e) => { e.stopPropagation(); onDeleteGroup(group.id); }} title={groupWorking ? 'Cannot delete while transcribing' : 'Delete group'} disabled={groupWorking}>x</button>
    </div>
    {#if !group.collapsed}
      <div class="pl-1">
        {#each group.lineIndices as lineIdx}
          {@render lineRow(doc, lineIdx)}
        {/each}
      </div>
    {/if}
  </div>
{/snippet}

{#snippet lineRow(doc: ImageDocument, lineIdx: number)}
  {#if doc.lines[lineIdx] && lineMatches(doc, lineIdx)}
    <div
      class="flex items-baseline gap-2 px-2 py-1 rounded cursor-pointer transition-colors {lineIdx === hoveredLine ? 'bg-orange-500/[0.08]' : ''} {selectedLines.has(lineIdx) ? 'bg-yellow-400/[0.12] outline outline-1 outline-yellow-400/30' : ''}"
      data-line={lineIdx}
      onmouseenter={() => onHoverLine(lineIdx)}
      onmouseleave={() => onHoverLine(-1)}
      onclick={(e) => handleLineClick(lineIdx, e)}
      ondblclick={() => startEditLine(lineIdx)}
    >
      <span class="text-muted-foreground text-xs min-w-[1.5rem] text-right font-mono select-none">{lineIdx + 1}</span>
      {#if editingLineIdx === lineIdx}
        <input
          class="flex-1 bg-card border border-border text-foreground font-inherit text-inherit px-1 py-0.5 rounded outline-none focus:border-primary"
          bind:value={editLineText}
          onkeydown={(e) => { if (e.key === 'Enter') finishEditLine(); if (e.key === 'Escape') editingLineIdx = -1; }}
          onblur={finishEditLine}
          onclick={(e) => e.stopPropagation()}
          ondblclick={(e) => e.stopPropagation()}
        />
      {:else}
        <span class="flex-1">
          {doc.lines[lineIdx].text}{#if !doc.lines[lineIdx].complete && doc.lines[lineIdx].text}<span class="animate-pulse text-orange-500">|</span>{/if}
        </span>
        {#if doc.lines[lineIdx].complete}
          <span class="text-xs text-muted-foreground font-mono">{(doc.lines[lineIdx].confidence * 100).toFixed(0)}%</span>
        {/if}
      {/if}
    </div>
  {/if}
{/snippet}
