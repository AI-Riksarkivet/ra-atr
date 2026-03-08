<script lang="ts">
  interface Props {
    onUpload: (imageData: ArrayBuffer, previewUrl: string) => void;
    disabled: boolean;
  }

  let { onUpload, disabled }: Props = $props();
  let dragOver = $state(false);
  let loadingDemo = $state(false);

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith('image/')) return;

    const previewUrl = URL.createObjectURL(file);
    file.arrayBuffer().then((buf) => onUpload(buf, previewUrl));
  }

  async function loadDemoImage() {
    loadingDemo = true;
    try {
      const res = await fetch('/demo.jpg');
      const buf = await res.arrayBuffer();
      const blob = new Blob([buf], { type: 'image/jpeg' });
      const previewUrl = URL.createObjectURL(blob);
      onUpload(buf, previewUrl);
    } finally {
      loadingDemo = false;
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    handleFiles(e.dataTransfer?.files ?? null);
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault();
    dragOver = true;
  }
</script>

<div
  class="upload-panel"
  class:drag-over={dragOver}
  class:disabled
  ondrop={onDrop}
  ondragover={onDragOver}
  ondragleave={() => (dragOver = false)}
  role="button"
  tabindex="0"
>
  <input
    type="file"
    accept="image/*"
    onchange={(e) => handleFiles(e.currentTarget.files)}
    {disabled}
    id="file-input"
  />
  <label for="file-input">
    <p>Drop an image here or click to upload</p>
  </label>
  <button class="demo-btn" onclick={loadDemoImage} disabled={disabled || loadingDemo}>
    {loadingDemo ? 'Loading...' : 'Try demo image'}
  </button>
</div>

<style>
  .upload-panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    border: 2px dashed var(--border-color, #555);
    border-radius: 12px;
    padding: 2rem;
    cursor: pointer;
    transition: border-color 0.2s, background-color 0.2s;
    min-height: 200px;
  }

  .upload-panel:hover,
  .upload-panel.drag-over {
    border-color: var(--accent-color, #3b82f6);
    background-color: var(--hover-bg, rgba(59, 130, 246, 0.05));
  }

  .upload-panel.disabled {
    opacity: 0.5;
    pointer-events: none;
  }

  input[type='file'] {
    display: none;
  }

  label {
    cursor: pointer;
    text-align: center;
  }

  p {
    margin: 0;
    color: var(--text-muted, #888);
    font-size: 0.95rem;
  }

  .demo-btn {
    margin-top: 1rem;
    padding: 0.5rem 1.25rem;
    border: 1px solid var(--border-color, #555);
    border-radius: 6px;
    background: var(--bg-secondary, #1e1e1e);
    color: var(--text-primary, #ddd);
    cursor: pointer;
    font-size: 0.85rem;
    transition: border-color 0.2s;
  }

  .demo-btn:hover:not(:disabled) {
    border-color: var(--accent-color, #3b82f6);
  }

  .demo-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
