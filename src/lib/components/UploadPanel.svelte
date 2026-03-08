<script lang="ts">
  interface Props {
    onUpload: (imageData: ArrayBuffer, previewUrl: string) => void;
    disabled: boolean;
  }

  let { onUpload, disabled }: Props = $props();
  let dragOver = $state(false);

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith('image/')) return;

    const previewUrl = URL.createObjectURL(file);
    file.arrayBuffer().then((buf) => onUpload(buf, previewUrl));
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
</div>

<style>
  .upload-panel {
    display: flex;
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
</style>
