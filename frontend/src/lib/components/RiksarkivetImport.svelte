<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { resolveVolume, type ImportProgress } from '$lib/riksarkivet';

	interface Props {
		onResolved: (manifestId: string, pages: number[]) => void;
		disabled: boolean;
	}

	let { onResolved, disabled }: Props = $props();
	let refCode = $state('SE/RA/756/756.1/O/I/O 8');
	let loading = $state(false);
	let progress = $state<ImportProgress | null>(null);

	async function handleImport() {
		if (!refCode.trim() || loading) return;
		loading = true;
		progress = null;
		try {
			const { manifestId, pages } = await resolveVolume(refCode.trim(), (p) => {
				progress = p;
			});
			onResolved(manifestId, pages);
		} catch {
			// error already in progress state
		} finally {
			loading = false;
		}
	}

	function statusText(p: ImportProgress): string {
		switch (p.stage) {
			case 'resolving':
				return 'Resolving reference code...';
			case 'manifest':
				return `Found ${p.manifestId}, loading manifest...`;
			case 'fetching':
				return `Loading page ${p.currentPage}/${p.totalPages}...`;
			case 'done':
				return `Found ${p.totalPages} pages`;
			case 'error':
				return p.error ?? 'Error';
		}
	}
</script>

<div class="flex flex-col gap-3">
	<div class="flex gap-2">
		<input
			type="text"
			bind:value={refCode}
			placeholder="Reference code or bild ID, e.g. R0003221"
			class="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
			disabled={disabled || loading}
			onkeydown={(e) => {
				if (e.key === 'Enter') handleImport();
			}}
		/>
		<Button
			variant="outline"
			size="sm"
			onclick={handleImport}
			disabled={disabled || loading || !refCode.trim()}
		>
			{loading ? 'Loading...' : 'Load'}
		</Button>
	</div>

	{#if progress}
		<div class="flex items-center gap-2 text-xs text-muted-foreground">
			{#if progress.stage === 'error'}
				<span class="text-destructive">{statusText(progress)}</span>
			{:else}
				<span>{statusText(progress)}</span>
			{/if}
		</div>
	{/if}
</div>
