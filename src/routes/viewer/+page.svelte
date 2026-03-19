<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount, tick } from 'svelte';
  import { appState } from '$lib/stores/app-state.svelte';
  import { resolveVolume } from '$lib/riksarkivet';
  import { fetchTranscriptions, BACKEND_ENABLED } from '$lib/api';
  import AppHeader from '$lib/components/layout/app-header.svelte';
  import DocumentViewer from '$lib/components/DocumentViewer.svelte';
  import TranscriptionPanel from '$lib/components/TranscriptionPanel.svelte';
  import CatalogPanel from '$lib/components/CatalogPanel.svelte';
  import UploadPanel from '$lib/components/UploadPanel.svelte';
  import type { Line, BBox } from '$lib/types';
  import { Maximize2, Plus, Minus, ChevronLeft, ChevronRight, Maximize, Printer, Play, RotateCcw, PenTool, Info, Type, SunMedium } from 'lucide-svelte';

  let leftWidth = $state(20);
  let rightWidth = $state(25);
  let leftCollapsed = $state(true);
  let rightCollapsed = $state(true);
  let draggingDivider = $state<'left' | 'right' | null>(null);
  let docViewer: DocumentViewer;
  let isFullscreen = $state(false);
  let metadataOpen = $state(false);
  let showTextOverlay = $state(false);
  let imageFilters = $state({ brightness: 100, contrast: 100, saturate: 100 });
  let showFilters = $state(false);

  // Redirect to home if models not loaded (wait for cache check first)
  $effect(() => {
    if (appState.htr.cacheChecked && !appState.htr.modelsReady && appState.htr.stage === 'idle') goto('/');
  });

  function handleUpload(files: { name: string; imageData: ArrayBuffer; previewUrl: string }[]) {
    const volumeId = appState.createUploadVolumeId();
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const docId = appState.addDocument(file.name, file.previewUrl, file.imageData, volumeId, i + 1);
      if (!appState.activeDocumentId) {
        appState.activeDocumentId = docId;
      }
    }
    rightCollapsed = false;
  }

  // Active document derived state
  let activeDoc = $derived(appState.activeDocument);
  let lines = $derived(activeDoc?.lines ?? []);

  // Reset line preview when switching pages
  let lastDocId = '';
  $effect(() => {
    const docId = activeDoc?.id ?? '';
    if (docId !== lastDocId) { lastDocId = docId; }
  });
  let groups = $derived(activeDoc?.groups ?? []);

  // Recenter viewer when panels open/close
  $effect(() => {
    void leftCollapsed;
    void rightCollapsed;
    setTimeout(() => docViewer?.resetView(), 50);
  });

  // Page navigation info
  let pageNav = $derived.by(() => {
    if (!activeDoc?.manifestId) return null;
    const siblings = appState.documents
      .filter(d => d.manifestId === activeDoc.manifestId)
      .sort((a, b) => (a.pageNumber ?? 0) - (b.pageNumber ?? 0));
    const idx = siblings.findIndex(d => d.id === activeDoc.id);
    return { current: idx + 1, total: siblings.length, hasPrev: idx > 0, hasNext: idx < siblings.length - 1 };
  });


  function deleteGroup(groupId: string) {
    if (!activeDoc) return;
    const group = activeDoc.groups.find(g => g.id === groupId);
    if (!group) return;
    if (group.regionId) {
      appState.htr.cancelRegion(group.regionId);
    }
    // Delete the group's lines
    const removeIds = new Set(group.lineIds);
    activeDoc.lines = activeDoc.lines.filter(l => !removeIds.has(l.id));
    activeDoc.groups = activeDoc.groups.filter(g => g.id !== groupId);
    appState.documents = [...appState.documents];
    if (activeDoc.manifestId) appState.scheduleAutoSave();
  }

  function renameGroup(groupId: string, name: string) {
    if (!activeDoc) return;
    activeDoc.groups = activeDoc.groups.map(g => g.id === groupId ? { ...g, name } : g);
    appState.documents = [...appState.documents];
  }

  function toggleGroup(groupId: string) {
    if (!activeDoc) return;
    activeDoc.groups = activeDoc.groups.map(g => g.id === groupId ? { ...g, collapsed: !g.collapsed } : g);
    appState.documents = [...appState.documents];
  }

  function onKeyDown(e: KeyboardEvent) {
    // Skip when focused on an input/textarea
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (e.key === 'ArrowLeft') { e.preventDefault(); appState.navigatePage(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); appState.navigatePage(1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); appState.navigateLine(-1); }
    if (e.key === 'ArrowDown') { e.preventDefault(); appState.navigateLine(1); }
  }

  let catalogLoading = $state('');
  let catalogError = $state('');
  let catalogPanel: CatalogPanel;

  function handleRiksarkivetResolved(manifestId: string, pages: number[]) {
    const existingPages = new Set(
      appState.documents.filter(d => d.manifestId === manifestId).map(d => d.pageNumber)
    );
    const newPages = pages.filter(p => !existingPages.has(p));

    let firstDocId = '';
    for (const page of newPages) {
      const padded = String(page).padStart(5, '0');
      const docId = appState.addPlaceholderDocument(
        `${manifestId}_${padded}.jpg`, manifestId, page
      );
      if (!firstDocId) firstDocId = docId;
    }

    // Switch to first page of new volume and show transcription panel
    if (firstDocId) {
      appState.switchDocument(firstDocId);
      rightCollapsed = false;
    }


    if (newPages.length > 0 && BACKEND_ENABLED) {
      fetchTranscriptions(manifestId).then(groups => {
        if (groups.length > 0) appState.populateFromBackend(manifestId, groups);
      }).catch(() => {});
    }
  }

  async function handleCatalogLoad(referenceCode: string, metadata?: import('$lib/api').CatalogResult) {
    if (catalogLoading) return;
    catalogLoading = 'Resolving...';
    catalogError = '';
    try {
      const { manifestId, pages } = await resolveVolume(referenceCode, (p) => {
        if (p.stage === 'resolving') catalogLoading = 'Resolving reference code...';
        else if (p.stage === 'manifest') catalogLoading = `Found ${p.manifestId}, loading manifest...`;
        else if (p.stage === 'done') catalogLoading = `Loading ${p.totalPages} pages...`;
      });
      if (metadata) {
        appState.volumeMetadata.set(manifestId, metadata);
        appState.volumeMetadata = new Map(appState.volumeMetadata);
      }
      handleRiksarkivetResolved(manifestId, pages);
    } catch (e) {
      catalogError = e instanceof Error ? e.message : 'Failed to load volume';
    } finally {
      catalogLoading = '';
    }
  }

  /** Run the HTR pipeline on a single page: layout → lines → transcription */
  function transcribePage(doc: import('$lib/types').ImageDocument) {
    // Don't re-run if already working on this page
    if (appState.htr.pendingImageIds.has(doc.id) || appState.htr.running) return;

    if (doc.groups.length > 0) {
      // Re-run on existing regions
      doc.lines = [];
      doc.lineCounter = 0;
      for (const group of doc.groups) {
        if (group.rect) {
          group.regionId = appState.htr.transcribeRegion(
            doc.id, group.rect.x, group.rect.y, group.rect.w, group.rect.h,
          );
          group.lineIds = [];
        }
      }
      appState.documents = [...appState.documents];
    } else {
      appState.htr.run(doc.id);
    }
  }

  /** Wait until all in-flight transcriptions finish */
  function waitForIdle(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (appState.htr.pendingLines === 0 && appState.htr.pendingRegions.size === 0) {
          resolve();
          return;
        }
        setTimeout(check, 500);
      };
      setTimeout(check, 1000);
    });
  }

  async function transcribeVolume(manifestId: string) {
    const pages = appState.documents
      .filter(d => d.manifestId === manifestId)
      .sort((a, b) => (a.pageNumber ?? 0) - (b.pageNumber ?? 0));

    const toProcess = pages.filter(d => d.groups.length === 0 || d.lines.some(l => !l.complete));
    if (toProcess.length === 0) return;

    appState.htr.batchProgress = { current: 0, total: toProcess.length };

    for (let pi = 0; pi < toProcess.length; pi++) {
      if (appState.htr.stage === 'idle' && pi > 0) break;
      appState.htr.batchProgress = { current: pi, total: toProcess.length };

      await appState.loadDocumentImage(toProcess[pi].id);
      appState.activeDocumentId = toProcess[pi].id;
      transcribePage(toProcess[pi]);
      await waitForIdle();
      if (toProcess[pi].manifestId) appState.scheduleAutoSave();
    }

    appState.htr.batchProgress = null;
  }

  onMount(() => {
    // Route region detections to the right document
    appState.htr.onRegionDetected = (imageId, regionId, _startIndex, bboxes) => {
      docViewer?.clearRedetecting(regionId);
      const assignedIds: number[] = [];
      appState.updateDocumentLines(imageId, (doc) => {
        for (const bbox of bboxes) {
          const lineId = doc.lineCounter++;
          doc.lines = [...doc.lines, {
            id: lineId,
            bbox,
            text: '',
            confidence: 0,
            complete: false,
          }];
          assignedIds.push(lineId);
        }
        doc.groups = doc.groups.map(g =>
          g.regionId === regionId ? { ...g, lineIds: assignedIds } : g
        );
      });
      return assignedIds;
    };

    // Route token updates to the right document
    appState.htr.onToken = (imageId, lineId, token) => {
      appState.updateDocumentLines(imageId, (doc) => {
        const line = doc.lines.find(l => l.id === lineId);
        if (line) line.text += token;
      });
    };

    // Route line completions to the right document
    appState.htr.onLineComplete = (imageId, lineId, text, confidence) => {
      appState.updateDocumentLines(imageId, (doc) => {
        const line = doc.lines.find(l => l.id === lineId);
        if (line) {
          line.text = text;
          line.confidence = confidence;
          line.complete = true;
        }
      });
    };

    // Route region completion
    appState.htr.onRegionComplete = (imageId, regionId) => {
      // Auto-save when a region finishes transcribing
      const doc = appState.documents.find(d => d.id === imageId);
      if (doc?.manifestId) appState.scheduleAutoSave();
    };

    // Route layout detection results — create groups and auto-run line detection
    appState.htr.onLayoutDetected = (imageId, regions) => {
      const doc = appState.documents.find(d => d.id === imageId);
      if (!doc) return;
      for (const region of regions) {
        doc.groupCounter++;
        const regionId = appState.htr.transcribeRegion(
          imageId, region.x, region.y, region.w, region.h,
        );
        doc.groups = [...doc.groups, {
          id: `group-${doc.groupCounter}`,
          name: `${region.label} (${Math.round(region.confidence * 100)}%)`,
          lineIds: [],
          collapsed: false,
          regionId,
          rect: { x: region.x, y: region.y, w: region.w, h: region.h },
        }];
      }
      appState.documents = [...appState.documents];
      rightCollapsed = false;
    };

    function onFullscreenChange() {
      isFullscreen = !!document.fullscreenElement;
      setTimeout(() => docViewer?.resetView(), 100);
    }
    document.addEventListener('fullscreenchange', onFullscreenChange);

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  });

  function onDividerPointerDown(side: 'left' | 'right', e: PointerEvent) {
    draggingDivider = side;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onDividerPointerMove(e: PointerEvent) {
    if (!draggingDivider) return;
    const container = (e.target as HTMLElement).parentElement!;
    const rect = container.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    if (draggingDivider === 'left') {
      leftWidth = Math.min(40, Math.max(12, pct));
    } else {
      rightWidth = Math.min(40, Math.max(12, 100 - pct));
    }
  }
  function onDividerPointerUp(e: PointerEvent) {
    draggingDivider = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }
</script>

<AppHeader
  catalogOpen={!leftCollapsed}
  transcriptionOpen={!rightCollapsed}
  onToggleCatalog={() => leftCollapsed = !leftCollapsed}
  onToggleTranscription={() => rightCollapsed = !rightCollapsed}
  onSearch={async (q) => {
    leftCollapsed = false;
    await tick();
    catalogPanel?.setSearch(q);
  }}
/>

{#if appState.htr.error}
  <div class="flex items-center gap-2 bg-destructive/10 px-4 py-2 text-sm text-destructive shrink-0">
    <span class="flex-1">{appState.htr.error}</span>
    <button class="text-destructive/60 hover:text-destructive cursor-pointer text-lg leading-none" onclick={() => appState.htr.error = ''}>&times;</button>
  </div>
{/if}
{#if catalogLoading}
  <div class="bg-muted px-4 py-1.5 text-xs text-muted-foreground animate-pulse shrink-0">{catalogLoading}</div>
{/if}
{#if catalogError}
  <div class="flex items-center gap-2 bg-destructive/10 px-4 py-1.5 text-xs text-destructive shrink-0">
    <span class="flex-1">{catalogError}</span>
    <button class="text-destructive/60 hover:text-destructive cursor-pointer text-sm leading-none" onclick={() => catalogError = ''}>&times;</button>
  </div>
{/if}



<div class="flex flex-1 overflow-hidden">
  <!-- Left: Catalog browser -->
  {#if BACKEND_ENABLED && !leftCollapsed}
    <div class="overflow-hidden border-r border-border flex flex-col" style="width: {leftWidth}%">
      <CatalogPanel bind:this={catalogPanel} onLoadVolume={(ref, meta) => handleCatalogLoad(ref, meta)} />
    </div>
    <div
      class="w-px shrink-0 cursor-col-resize touch-none transition-all hover:w-1 hover:bg-primary/50 active:bg-primary group relative"
      class:bg-primary={draggingDivider === 'left'}
      onpointerdown={(e) => onDividerPointerDown('left', e)}
      onpointermove={onDividerPointerMove}
      onpointerup={onDividerPointerUp}
      ondblclick={() => leftCollapsed = true}
      role="separator"
      title="Drag to resize, double-click to collapse"
    ></div>
  {/if}

  <!-- Center: Document viewer -->
  <div class="relative overflow-hidden flex-1">
    {#if activeDoc}
      <DocumentViewer
        bind:this={docViewer}
        imageUrl={activeDoc?.imageUrl ?? null}
        lines={lines}
        currentLine={-1}
        hoveredLine={appState.hoveredLine}
        onHoverLine={(i) => appState.hoveredLine = i}
        stage={appState.htr.stage}
        selectedLines={new Set()}
        onSelectLine={() => {}}
        onMarqueeSelect={() => {}}
        onRedetectRegion={(x, y, w, h) => {
          if (!activeDoc) return '';
          const regionId = appState.htr.transcribeRegion(activeDoc.id, x, y, w, h);
          activeDoc.groupCounter++;
          activeDoc.groups = [...activeDoc.groups, {
            id: `group-${activeDoc.groupCounter}`,
            name: `Group ${activeDoc.groupCounter}`,
            lineIds: [],
            collapsed: false,
            regionId,
            rect: { x, y, w, h },
          }];
          appState.documents = [...appState.documents];
          return regionId;
        }}
        groups={groups}
        selectMode={appState.selectMode}
        showTextOverlay={showTextOverlay}
        imageFilter={`brightness(${imageFilters.brightness}%) contrast(${imageFilters.contrast}%) saturate(${imageFilters.saturate}%)`}
      />

      <!-- Page navigation -->
      {#if pageNav}
        {#if pageNav.hasPrev}
          <button
            class="absolute left-3 top-1/2 -translate-y-1/2 size-9 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white/70 hover:text-white hover:bg-black/60 transition-all cursor-pointer"
            onclick={() => appState.navigatePage(-1)}
            title="Previous page"
          ><ChevronLeft class="size-5" /></button>
        {/if}
        {#if pageNav.hasNext}
          <button
            class="absolute right-3 top-1/2 -translate-y-1/2 size-9 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white/70 hover:text-white hover:bg-black/60 transition-all cursor-pointer"
            onclick={() => appState.navigatePage(1)}
            title="Next page"
          ><ChevronRight class="size-5" /></button>
        {/if}
      {/if}

      <!-- Metadata panel -->
      {#if metadataOpen && activeDoc?.manifestId}
        {@const meta = appState.volumeMetadata.get(activeDoc.manifestId)}
        {#if meta}
          <div class="absolute bottom-16 left-1/2 -translate-x-1/2 rounded-lg bg-black/50 backdrop-blur-xl border border-white/[0.06] shadow-xl px-4 py-3 text-[0.7rem] text-white/80 leading-relaxed space-y-1 min-w-[280px] max-w-[400px] shadow-lg">
            <div class="font-semibold text-white">{meta.fonds_title}</div>
            {#if meta.creator}<div class="text-white/60">{meta.creator}</div>{/if}
            {#if meta.series_title}<div>{meta.series_title}{meta.volume_id ? `, vol. ${meta.volume_id}` : ''}</div>{/if}
            {#if meta.date_text}<div class="text-white/50">{meta.date_text}</div>{/if}
            {#if meta.description}<div class="text-white/50 line-clamp-4">{meta.description}</div>{/if}
            <div class="text-white/30 font-mono text-[0.6rem] pt-1">{meta.reference_code}</div>
          </div>
        {/if}
      {/if}

      <!-- Floating toolbar -->
      {@const pageTranscribed = activeDoc && activeDoc.lines.length > 0 && activeDoc.lines.every(l => l.complete)}
      {@const isRunning = appState.htr.running || appState.htr.pendingRegions.size > 0 || appState.htr.pendingLines > 0}
      {@const totalLines = activeDoc?.lines.length ?? 0}
      {@const completedLines = activeDoc?.lines.filter(l => l.complete).length ?? 0}
      <div class="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-3 rounded-xl bg-black/40 backdrop-blur-xl border border-white/[0.06] shadow-2xl shadow-black/40 px-4 py-2 text-[0.7rem] text-white/70">
        {#if activeDoc?.manifestId}
          {@const siblings = appState.documents.filter(d => d.manifestId === activeDoc.manifestId)}
          {@const meta = appState.volumeMetadata.get(activeDoc.manifestId)}
          <span class="font-mono tabular-nums" title="Page {activeDoc.pageNumber ?? '?'} of {siblings.length}">{activeDoc.pageNumber ?? '?'}<span class="text-white/40">/{siblings.length}</span></span>
          {#if meta}
            <span class="text-white/20">&middot;</span>
            <span class="truncate max-w-[200px]">{meta.fonds_title}</span>
          {/if}
          <button
            class="size-6 rounded-full flex items-center justify-center transition-all cursor-pointer {metadataOpen ? 'bg-white/30 text-white' : 'bg-white/10 text-white/50 hover:text-white hover:bg-white/20'}"
            onclick={() => metadataOpen = !metadataOpen}
            title="Volume details"
          ><Info class="size-3" /></button>
        {/if}
        {#if totalLines > 0}
          <span class="text-white/20">&middot;</span>
          <span class="font-mono tabular-nums" title="{completedLines} of {totalLines} lines transcribed">{completedLines}/{totalLines}</span>
        {/if}
        {#if appState.htr.pendingLines > 0}
          <span class="text-orange-400 font-mono" title="{appState.htr.pendingLines} lines currently being transcribed">{appState.htr.pendingLines} in-flight</span>
        {/if}
        {#if appState.saving}
          <span class="text-white/40 animate-pulse" title="Saving transcriptions to server">saving</span>
        {/if}
        <span class="text-white/20">|</span>
        <button
          class="size-8 rounded-full bg-white/10 flex items-center justify-center text-white/70 hover:text-white hover:bg-white/20 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
          disabled={isRunning}
          onclick={() => { if (activeDoc) transcribePage(activeDoc); }}
          title={pageTranscribed ? 'Re-transcribe page' : 'Transcribe page'}
        >
          {#if pageTranscribed}
            <RotateCcw class="size-4" />
          {:else}
            <Play class="size-4" />
          {/if}
        </button>
        <button
          class="size-8 rounded-full flex items-center justify-center transition-all cursor-pointer {appState.selectMode ? 'bg-white/30 text-white' : 'bg-white/10 text-white/70 hover:text-white hover:bg-white/20'}"
          onclick={() => appState.selectMode = !appState.selectMode}
          title={appState.selectMode ? 'Switch to pan mode' : 'Draw region to transcribe'}
        ><PenTool class="size-4" /></button>
        <button
          class="size-8 rounded-full flex items-center justify-center transition-all cursor-pointer {showTextOverlay ? 'bg-white/30 text-white' : 'bg-white/10 text-white/70 hover:text-white hover:bg-white/20'}"
          onclick={() => showTextOverlay = !showTextOverlay}
          title={showTextOverlay ? 'Hide text overlay' : 'Show transcriptions on image'}
        ><Type class="size-4" /></button>
        <div class="relative">
          <button
            class="size-8 rounded-full flex items-center justify-center transition-all cursor-pointer {showFilters ? 'bg-white/30 text-white' : 'bg-white/10 text-white/70 hover:text-white hover:bg-white/20'}"
            onclick={() => showFilters = !showFilters}
            title="Image adjustments"
          ><SunMedium class="size-4" /></button>
          {#if showFilters}
            <div class="absolute bottom-full right-0 mb-2 rounded-lg bg-black/50 backdrop-blur-xl border border-white/[0.06] shadow-xl p-3 space-y-2 min-w-[180px] shadow-lg">
              <div class="flex items-center justify-between text-[0.65rem] text-white/70">
                <span>Brightness</span>
                <span class="font-mono text-white/40">{imageFilters.brightness}%</span>
              </div>
              <input type="range" min="20" max="250" bind:value={imageFilters.brightness} class="w-full h-1 accent-white/70" />
              <div class="flex items-center justify-between text-[0.65rem] text-white/70">
                <span>Contrast</span>
                <span class="font-mono text-white/40">{imageFilters.contrast}%</span>
              </div>
              <input type="range" min="20" max="300" bind:value={imageFilters.contrast} class="w-full h-1 accent-white/70" />
              <div class="flex items-center justify-between text-[0.65rem] text-white/70">
                <span>Saturation</span>
                <span class="font-mono text-white/40">{imageFilters.saturate}%</span>
              </div>
              <input type="range" min="0" max="200" bind:value={imageFilters.saturate} class="w-full h-1 accent-white/70" />
              <button
                class="w-full text-[0.6rem] text-white/40 hover:text-white/70 transition-colors cursor-pointer pt-1"
                onclick={() => imageFilters = { brightness: 100, contrast: 100, saturate: 100 }}
              >Reset</button>
            </div>
          {/if}
        </div>
      </div>

      <!-- Zoom controls -->
      <div class="absolute top-3 right-3 flex flex-col rounded-lg bg-black/40 backdrop-blur-md overflow-hidden">
        <button
          class="size-8 flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
          onclick={() => docViewer?.zoomIn()}
          title="Zoom in"
        ><Plus class="size-4" /></button>
        <div class="h-px bg-white/10"></div>
        <button
          class="size-8 flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
          onclick={() => docViewer?.resetView()}
          title="Fit to page"
        ><Maximize2 class="size-3.5" /></button>
        <div class="h-px bg-white/10"></div>
        <button
          class="size-8 flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
          onclick={() => docViewer?.zoomOut()}
          title="Zoom out"
        ><Minus class="size-4" /></button>
        <div class="h-px bg-white/10"></div>
        <button
          class="size-8 flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
          onclick={() => { document.querySelector('.relative.overflow-hidden.flex-1')?.requestFullscreen(); setTimeout(() => docViewer?.resetView(), 100); }}
          title="Fullscreen"
        ><Maximize class="size-3.5" /></button>
        <div class="h-px bg-white/10"></div>
        <button
          class="size-8 flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
          onclick={() => {
            if (!activeDoc?.imageUrl) return;
            const w = window.open('');
            if (w) {
              w.document.write(`<img src="${activeDoc.imageUrl}" style="max-width:100%">`);
              w.document.close();
              w.onload = () => { w.print(); w.close(); };
            }
          }}
          title="Print page"
        ><Printer class="size-3.5" /></button>
      </div>
    {:else}
      <div class="absolute inset-0 flex items-center justify-center">
        <video class="absolute inset-0 w-full h-full object-cover opacity-10 pointer-events-none" src="/flying-papers.mp4" loop muted autoplay playsinline></video>
        <div class="relative w-full max-w-md space-y-5 p-8">
          <UploadPanel
            onUpload={handleUpload}
            disabled={!appState.htr.modelsReady}
          />
        </div>
      </div>
    {/if}
  </div>

  <!-- Right: Transcription tree -->
  {#if !rightCollapsed}
    <div
      class="w-[5px] shrink-0 cursor-col-resize touch-none transition-colors hover:bg-primary"
      class:bg-primary={draggingDivider === 'right'}
      onpointerdown={(e) => onDividerPointerDown('right', e)}
      onpointermove={onDividerPointerMove}
      onpointerup={onDividerPointerUp}
      ondblclick={() => rightCollapsed = true}
      role="separator"
      title="Drag to resize, double-click to collapse"
    ></div>
    <div class="overflow-hidden border-l border-border flex flex-col" style="width: {rightWidth}%">
      <TranscriptionPanel
        documents={appState.documents}
        activeDocumentId={appState.activeDocumentId}
        onSwitchDocument={(id) => appState.switchDocument(id)}
        hoveredLine={appState.hoveredLine}
        onHoverLine={(i) => appState.hoveredLine = i}
        selectedLines={new Set()}
        onSelectLine={() => {}}
        onToggleGroup={toggleGroup}
        onRenameGroup={renameGroup}
        onDeleteGroup={deleteGroup}
        onRemoveVolume={(manifestId) => appState.removeVolume(manifestId)}
        onTranscribeVolume={(manifestId) => transcribeVolume(manifestId)}
        onFocusGroup={(lineIds, rect) => {
          if (lineIds.length > 0) {
            // Resolve line IDs to Line objects for focusing
            const bboxes = lineIds.map(id => activeDoc?.lines.find(l => l.id === id)?.bbox).filter(Boolean);
            if (bboxes.length > 0) {
              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
              for (const b of bboxes) {
                if (!b) continue;
                minX = Math.min(minX, b.x);
                minY = Math.min(minY, b.y);
                maxX = Math.max(maxX, b.x + b.w);
                maxY = Math.max(maxY, b.y + b.h);
              }
              docViewer?.focusRect(minX, minY, maxX - minX, maxY - minY);
            }
          } else if (rect) docViewer?.focusRect(rect.x, rect.y, rect.w, rect.h);
        }}
        onFocusLine={(lineId) => {
          const line = activeDoc?.lines.find(l => l.id === lineId);
          if (line) docViewer?.focusRect(line.bbox.x, line.bbox.y, line.bbox.w, line.bbox.h);
        }}
        onEditLine={(lineId, text) => {
          const line = activeDoc?.lines.find(l => l.id === lineId);
          if (line) {
            line.text = text;
            appState.documents = [...appState.documents];
            if (activeDoc?.manifestId) appState.scheduleAutoSave();
          }
        }}
        selectMode={appState.selectMode}
        pendingRegions={appState.htr.pendingRegions}
        pendingImageIds={appState.htr.pendingImageIds}
      />
    </div>
  {/if}
</div>


