<script lang="ts">
	import '../app.css';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from 'svelte-sonner';
	import DotGrid from '$lib/components/DotGrid.svelte';
	import type { Snippet } from 'svelte';
	let { children }: { children: Snippet } = $props();
</script>

<ModeWatcher defaultMode="dark" />
<Toaster />
<DotGrid />

<div class="flex h-screen flex-col overflow-hidden relative z-[1]">
	{@render children()}
</div>
