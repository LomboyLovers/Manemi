import Skeleton from "./skeleton";

/** Group details loading state. Returns the same top-level sections as the
 *  loaded page (heading, summary, expenses) so the desktop two-column grid
 *  places them identically. */
export default function GroupDetailsSkeleton() {
  return (
    <>
      <section className="md-group-heading" role="status" aria-label="Loading group details">
        <Skeleton width="56px" height="56px" radius="16px" />
        <div style={{ flex: 1 }}>
          <Skeleton width="55%" height="26px" />
          <Skeleton width="35%" height="12px" style={{ marginTop: 10 }} />
        </div>
      </section>

      <section className="md-summary" aria-hidden="true">
        <Skeleton width="65%" height="12px" />
        <Skeleton width="55%" height="38px" style={{ marginTop: 12 }} />
        <div className="md-skeleton-stats">
          {[1, 2, 3].map((item) => (
            <div className="md-skeleton-stat" key={item}>
              <Skeleton width="65%" height="20px" radius="8px" />
              <Skeleton width="85%" height="11px" radius="6px" style={{ marginTop: 9 }} />
            </div>
          ))}
        </div>
        <Skeleton height="64px" radius="14px" style={{ marginTop: 16 }} />
      </section>

      <section className="md-expenses-section" aria-hidden="true">
        <Skeleton height="50px" radius="14px" />
        <div className="md-skeleton-filters">
          <Skeleton width="55px" height="36px" radius="20px" />
          <Skeleton width="85px" height="36px" radius="20px" />
          <Skeleton width="105px" height="36px" radius="20px" />
        </div>
        {[1, 2, 3, 4, 5].map((item) => (
          <div className="md-transaction-card" key={item}>
            <Skeleton width="44px" height="44px" radius="12px" />
            <div style={{ flex: 1 }}>
              <Skeleton width="70%" height="15px" />
              <Skeleton width="45%" height="11px" style={{ marginTop: 10 }} />
            </div>
            <Skeleton width="80px" height="18px" />
          </div>
        ))}
      </section>
    </>
  );
}
