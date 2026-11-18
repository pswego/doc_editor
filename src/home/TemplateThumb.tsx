/** 서식 문서 미리보기 그림 (디자인 레퍼런스 01) */
export function TemplateThumb({ id }: { id: string }) {
  switch (id) {
    case 'report':
      return (
        <div className="tpv" aria-hidden="true">
          <div style={{ borderTop: '3px double #111316', margin: '0 6px 6px' }} />
          <span className="ln" style={{ width: '60%', alignSelf: 'center', background: '#9CA3AF' }} />
          <span className="ln" style={{ width: '30%', alignSelf: 'flex-end', marginTop: 4 }} />
          <span className="ln" style={{ width: '40%', marginTop: 8, background: '#6B7280' }} />
          <span className="ln" />
          <span className="ln" style={{ width: '85%' }} />
          <span className="ln" style={{ width: '92%' }} />
        </div>
      );
    case 'official':
      return (
        <div className="tpv" aria-hidden="true">
          <span className="ln" style={{ width: '45%', alignSelf: 'center', height: 7, background: '#6B7280' }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 3, marginTop: 8 }}>
            <span className="ln" style={{ height: 12 }} /><span className="ln" style={{ height: 12 }} /><span className="ln" style={{ height: 12 }} /><span className="ln" style={{ height: 12 }} />
          </div>
          <span className="ln" style={{ marginTop: 6 }} />
          <span className="ln" style={{ width: '70%' }} />
          <div style={{ marginTop: 'auto', alignSelf: 'flex-end', width: 26, height: 26, border: '1.5px solid #C2410C', borderRadius: '50%' }} />
        </div>
      );
    case 'resume':
      return (
        <div className="tpv" aria-hidden="true">
          <span className="ln" style={{ width: '35%', height: 7, background: '#6B7280' }} />
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <span style={{ width: 30, height: 36, background: '#E4E7EC', borderRadius: 3 }} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span className="ln" /><span className="ln" style={{ width: '70%' }} /><span className="ln" style={{ width: '80%' }} />
            </div>
          </div>
          <span className="ln" style={{ marginTop: 6, width: '40%', background: '#9CA3AF' }} />
          <span className="ln" />
        </div>
      );
    case 'minutes':
      return (
        <div className="tpv" aria-hidden="true">
          <span className="ln" style={{ width: '40%', alignSelf: 'center', height: 7, background: '#6B7280' }} />
          <div style={{ border: '1px solid #D5D9E0', marginTop: 6, display: 'flex', flexDirection: 'column' }}>
            <span style={{ height: 12, borderBottom: '1px solid #D5D9E0', background: '#F4F5F7' }} />
            <span style={{ height: 12, borderBottom: '1px solid #D5D9E0' }} />
            <span style={{ height: 12 }} />
          </div>
          <span className="ln" style={{ marginTop: 6 }} />
          <span className="ln" style={{ width: '75%' }} />
        </div>
      );
    case 'contract':
      return (
        <div className="tpv" aria-hidden="true">
          <span className="ln" style={{ width: '50%', alignSelf: 'center', height: 7, background: '#6B7280' }} />
          <span className="ln" style={{ width: '30%', marginTop: 8, background: '#9CA3AF' }} />
          <span className="ln" />
          <span className="ln" style={{ width: '30%', marginTop: 4, background: '#9CA3AF' }} />
          <span className="ln" style={{ width: '90%' }} />
          <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between' }}>
            <span className="ln" style={{ width: '40%' }} /><span className="ln" style={{ width: '40%' }} />
          </div>
        </div>
      );
    default:
      return <div className="tpv" aria-hidden="true" />;
  }
}
