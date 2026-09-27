export function Placeholder({ title }: { title: string }) {
  return (
    <div className="wb-page">
      <div className="wb-page-heading">
        <div>
          <h1>{title}</h1>
          <p>让阅读、思考和研究有序连接。</p>
        </div>
      </div>
      <div className="wb-empty wb-placeholder">
        <h2>{title}</h2>
        <p>将在 R2–R4 提供</p>
      </div>
    </div>
  );
}
