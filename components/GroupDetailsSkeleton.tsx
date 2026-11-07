import Skeleton from "./skeleton";

export default function GroupDetailsSkeleton() {
  return (
    <div
      className="md-skeleton-screen"
      role="status"
      aria-label="Loading group details"
    >
      <div className="md-group-heading">
        <Skeleton width="50px" height="50px" radius="14px" />
        <div style={{ flex: 1 }}>
          <Skeleton width="55%" height="23px" />
          <Skeleton width="35%" height="12px" style={{ marginTop: 10 }} />
        </div>
      </div>

      <section className="md-summary">
        <Skeleton width="65%" height="12px" />
        <Skeleton width="55%" height="34px" style={{ marginTop: 12 }} />

        <div className="md-skeleton-stats">
          {[1, 2, 3].map((item) => (
            <div className="md-skeleton-stat" key={item}>
              <Skeleton width="65%" height="20px" radius="8px" />
              <Skeleton
                width="85%"
                height="11px"
                radius="6px"
                style={{ marginTop: 9 }}
              />
            </div>
          ))}
        </div>

        <Skeleton height="52px" radius="12px" style={{ marginTop: 16 }} />
      </section>

      <div className="md-skeleton-tabs">
        <Skeleton height="44px" />
      </div>

      <div className="md-skeleton-filters">
        <Skeleton width="55px" height="32px" radius="20px" />
        <Skeleton width="85px" height="32px" radius="20px" />
        <Skeleton width="105px" height="32px" radius="20px" />
      </div>

      {[1, 2, 3, 4, 5, 6].map((item) => (
        <div className="md-transaction-card" key={item}>
          <Skeleton width="42px" height="42px" radius="12px" />

          <div style={{ flex: 1 }}>
            <Skeleton width="75%" height="15px" />
            <Skeleton width="50%" height="11px" style={{ marginTop: 10 }} />
          </div>

          <Skeleton width="75px" height="18px" />
        </div>
      ))}
    </div>
  );
}
