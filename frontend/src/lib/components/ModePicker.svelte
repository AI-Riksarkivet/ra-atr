<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Server, Monitor } from 'lucide-svelte';
	import { gpuServerUrl, probeGpuServer, getGpuName } from '$lib/gpu-client';
	import { t } from '$lib/i18n.svelte';

	interface Props {
		modelsCached: boolean;
		onChooseGpu: () => void;
		onChooseWasm: () => void;
	}

	let { modelsCached, onChooseGpu, onChooseWasm }: Props = $props();

	let gpuUrl = $state(gpuServerUrl.get());
	let gpuStatus = $state<'idle' | 'checking' | 'ok' | 'error'>('idle');
	let gpuName = $state('');

	async function connectGpu() {
		const url = gpuUrl.trim();
		if (!url) return;
		gpuStatus = 'checking';
		const ok = await probeGpuServer(url);
		if (ok) {
			gpuServerUrl.set(url);
			gpuStatus = 'ok';
			gpuName = getGpuName();
			onChooseGpu();
		} else {
			gpuStatus = 'error';
		}
	}
</script>

<div class="space-y-3 text-center mb-6">
	<h1
		class="text-3xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent"
	>
		{t('app.title')}
	</h1>
	<p class="text-sm text-muted-foreground leading-relaxed max-w-sm mx-auto">
		{t('app.description')}
	</p>
</div>

<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-2xl">
	<!-- GPU card -->
	<div class="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm p-5 space-y-4">
		<div class="flex items-center gap-2">
			<div class="size-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
				<Server class="size-4" />
			</div>
			<div>
				<h3 class="text-sm font-semibold">{t('mode.gpu.title')}</h3>
			</div>
		</div>
		<p class="text-xs text-muted-foreground">{t('mode.gpu.desc')}</p>
		<div class="flex gap-1.5">
			<input
				type="text"
				bind:value={gpuUrl}
				placeholder={t('mode.gpu.placeholder')}
				class="flex-1 rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
				onkeydown={(e) => {
					if (e.key === 'Enter') connectGpu();
				}}
			/>
			<Button size="sm" onclick={connectGpu} disabled={gpuStatus === 'checking' || !gpuUrl.trim()}>
				{gpuStatus === 'checking' ? t('mode.gpu.connecting') : t('mode.gpu.connect')}
			</Button>
		</div>
		{#if gpuStatus === 'ok'}
			<p class="text-xs text-green-500">
				{t('mode.gpu.connected')}{gpuName ? ` — ${gpuName}` : ''}
			</p>
		{:else if gpuStatus === 'error'}
			<p class="text-xs text-destructive">{t('mode.gpu.error')}</p>
		{/if}
	</div>

	<!-- WASM card -->
	<div class="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm p-5 space-y-4">
		<div class="flex items-center gap-2">
			<div
				class="size-8 rounded-lg bg-muted text-muted-foreground flex items-center justify-center"
			>
				<Monitor class="size-4" />
			</div>
			<div>
				<h3 class="text-sm font-semibold">{t('mode.wasm.title')}</h3>
			</div>
		</div>
		{#if modelsCached}
			<p class="text-xs text-green-500">{t('mode.wasm.cached')}</p>
			<Button class="w-full" onclick={onChooseWasm}>{t('mode.wasm.continue')}</Button>
		{:else}
			<p class="text-xs text-muted-foreground">{t('mode.wasm.desc')}</p>
			<Button class="w-full" variant="outline" onclick={onChooseWasm}>{t('models.download')}</Button
			>
		{/if}
	</div>
</div>
