export function ColorGrid({ colors, value, onPick, noneLabel }: { colors: string[]; value?: string | null; onPick: (c: string | null) => void; noneLabel?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 4 }}>
      <div role="radiogroup" aria-label="색" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 28px)', gap: 6 }}>
        {colors.map((c) => (
          <button
            key={c}
            role="radio"
            aria-checked={value?.toUpperCase() === c.toUpperCase()}
            aria-label={c}
            className="swatch"
            style={{ background: c, boxShadow: value?.toUpperCase() === c.toUpperCase() ? '0 0 0 2px #191C21' : '0 0 0 1px #D5D9E0' }}
            onClick={() => onPick(c)}
          />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {noneLabel && (
          <button className="btn btn-outline btn-sm" onClick={() => onPick(null)}>
            {noneLabel}
          </button>
        )}
        <label className="btn btn-outline btn-sm" style={{ position: 'relative' }}>
          다른 색…
          <input type="color" aria-label="색 직접 고르기" value={value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(e) => onPick(e.target.value.toUpperCase())} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
        </label>
      </div>
    </div>
  );
}
