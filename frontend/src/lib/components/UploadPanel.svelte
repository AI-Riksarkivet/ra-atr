<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { cn } from '$lib/utils';
	import { t } from '$lib/i18n.svelte';

	interface Props {
		onUpload: (files: { name: string; imageData: ArrayBuffer; previewUrl: string }[]) => void;
		disabled: boolean;
	}

	let { onUpload, disabled }: Props = $props();
	let dragOver = $state(false);
	let loadingDemo = $state(false);
	let fileInput: HTMLInputElement;

	async function handleFiles(files: FileList | null) {
		if (!files || files.length === 0) return;
		const results: { name: string; imageData: ArrayBuffer; previewUrl: string }[] = [];
		for (const file of files) {
			if (!file.type.startsWith('image/')) continue;
			const previewUrl = URL.createObjectURL(file);
			const buf = await file.arrayBuffer();
			results.push({ name: file.name, imageData: buf, previewUrl });
		}
		if (results.length > 0) onUpload(results);
	}

	async function loadDemoImage() {
		loadingDemo = true;
		try {
			const res = await fetch('/demo.jpg');
			const buf = await res.arrayBuffer();
			const blob = new Blob([buf], { type: 'image/jpeg' });
			const previewUrl = URL.createObjectURL(blob);
			onUpload([{ name: 'demo.jpg', imageData: buf, previewUrl }]);
		} finally {
			loadingDemo = false;
		}
	}
</script>

<div class="flex flex-col gap-4">
	<div
		class={cn(
			'flex min-h-[280px] flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed p-10 transition-colors cursor-pointer backdrop-blur-md bg-card/30',
			dragOver ? 'border-primary bg-primary/10' : 'border-muted-foreground/20',
			disabled && 'opacity-50 pointer-events-none',
		)}
		ondrop={(e) => {
			e.preventDefault();
			dragOver = false;
			handleFiles(e.dataTransfer?.files ?? null);
		}}
		ondragover={(e) => {
			e.preventDefault();
			dragOver = true;
		}}
		ondragleave={() => (dragOver = false)}
		onclick={() => {
			if (!disabled) fileInput?.click();
		}}
		role="button"
		tabindex="0"
	>
		<input
			bind:this={fileInput}
			type="file"
			accept="image/*"
			multiple
			class="hidden"
			onchange={(e) => handleFiles(e.currentTarget.files)}
			{disabled}
		/>
		<div class="text-center space-y-1">
			<p class="text-base font-medium text-foreground/80">{t('upload.drop')}</p>
			<p class="text-xs text-muted-foreground">{t('upload.hint1')}</p>
			<p class="text-xs text-muted-foreground">
				{t('upload.hint2')}
				<span class="inline-flex items-center align-middle"
					><svg class="size-3.5 inline" viewBox="0 0 24 24" fill="currentColor"
						><polygon points="5,3 19,12 5,21" /></svg
					></span
				>
				{t('upload.hint3')}
			</p>
		</div>
		<Button
			variant="outline"
			size="sm"
			onclick={(e) => {
				e.stopPropagation();
				loadDemoImage();
			}}
			disabled={disabled || loadingDemo}
		>
			{loadingDemo ? t('upload.loading') : t('upload.demo')}
		</Button>
	</div>
</div>
