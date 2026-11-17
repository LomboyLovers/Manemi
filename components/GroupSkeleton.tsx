import Skeleton from "./skeleton";

/** Groups loading state, built on the real Groups page classes so it matches
 *  the loaded layout: net balance, tiles, filters, search, two-part cards. */
export default function GroupsSkeleton() {
  return (
    <div role="status" aria-label="Loading groups">
      <div className="mn-page-header">
        <Skeleton width="48px" height="48px" radius="50%" />
        <div className="mn-header-actions">
          {[1, 2, 3].map((item) => (
            <Skeleton key={item} width="48px" height="48px" radius="50%" />
          ))}
        </div>
      </div>

      <div className="manemi-rich-heading">
        <Skeleton width="180px" height="40px" radius="10px" />
        <Skeleton width="min(340px, 80%)" height="14px" style={{ margin: "12px 0 25px" }} />
      </div>

      <section className="manemi-rich-balances" aria-hidden="true">
        <Skeleton width="140px" height="12px" radius="6px" />
        <div className="manemi-net-balance" style={{ marginTop: 18 }}>
          <Skeleton width="150px" height="12px" radius="6px" />
          <Skeleton width="min(260px, 70%)" height="40px" radius="10px" style={{ marginTop: 6 }} />
          <Skeleton width="200px" height="12px" radius="6px" style={{ marginTop: 6 }} />
        </div>
        <div className="manemi-rich-balance-grid">
          {[1, 2].map((item) => (
            <div className="manemi-rich-balance-box" key={item}>
              <Skeleton width="95px" height="12px" radius="6px" />
              <Skeleton width="75%" height="30px" radius="8px" style={{ marginTop: 10 }} />
              <Skeleton width="80px" height="11px" radius="6px" style={{ marginTop: 8 }} />
            </div>
          ))}
        </div>
      </section>

      <div className="manemi-rich-filter-list" aria-hidden="true">
        {[52, 84, 118, 132, 82, 74].map((width, index) => (
          <Skeleton key={index} width={`${width}px`} height="42px" radius="999px" style={{ flex: "none" }} />
        ))}
      </div>

      <Skeleton height="44px" radius="14px" style={{ margin: "4px 0 24px" }} />

      <section className="manemi-rich-group-section" aria-hidden="true">
        <Skeleton width="90px" height="12px" radius="6px" style={{ marginBottom: 16 }} />
        <div className="manemi-rich-group-grid">
          {[1, 2, 3, 4].map((item) => (
            <article className="manemi-rich-group-card manemi-skeleton-card" key={item}>
              <div className="manemi-rich-card-top">
                <Skeleton width="48px" height="48px" radius="15px" />
                <Skeleton width="28px" height="10px" radius="6px" />
              </div>
              <Skeleton width="65%" height="20px" />
              <Skeleton width="40%" height="11px" style={{ marginTop: 8 }} />
              <div className="manemi-card-body">
                <div>
                  <Skeleton width="90px" height="11px" radius="6px" />
                  <Skeleton width="80%" height="28px" radius="8px" style={{ marginTop: 8 }} />
                  <Skeleton width="70px" height="12px" radius="6px" style={{ marginTop: 8 }} />
                </div>
                <div className="manemi-card-breakdown">
                  <Skeleton width="80px" height="11px" radius="6px" />
                  <Skeleton width="100%" height="13px" radius="6px" />
                  <Skeleton width="85%" height="13px" radius="6px" />
                  <Skeleton width="60%" height="11px" radius="6px" />
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
