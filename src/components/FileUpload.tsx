import { useCallback } from 'react';

interface FileUploadProps {
  onFileLoaded: (buffer: ArrayBuffer, fileName: string) => void;
  loading: boolean;
}

export function FileUpload({ onFileLoaded, loading }: FileUploadProps) {
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) readFile(file);
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) readFile(file);
  }, []);

  function readFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        onFileLoaded(reader.result, file.name);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  return (
    <div
      className="upload-zone"
      onDrop={handleDrop}
      onDragOver={e => e.preventDefault()}
    >
      <div className="upload-content">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <h2>Lataa FIT-tiedosto</h2>
        <p>Vedä ja pudota .FIT-tiedosto tähän tai klikkaa valitaksesi</p>
        <p className="hint">Vie tiedosto Garmin Connectista: Aktiviteetti → ⚙️ → Vie alkuperäinen</p>
        <input
          type="file"
          accept=".fit,.FIT"
          onChange={handleChange}
          disabled={loading}
        />
        {loading && <div className="spinner" />}
      </div>
    </div>
  );
}
