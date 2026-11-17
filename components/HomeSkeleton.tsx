import Skeleton from "./skeleton";

/** Home loading state, built on the real dashboard classes so it keeps the
 *  same responsive layout (phone column, wide grid on desktop). */
export default function HomeSkeleton() {
  return (
    <div role="status" aria-label="Loading your home screen">
      <div className="mn-page-header">
        <Skeleton width="48px" height="48px" radius="50%" />
        <Skeleton width="48px" height="48px" radius="50%" />
      </div>

      <section className="dashboard-greeting">
        <Skeleton width="min(320px, 70%)" height="34px" radius="10px" />
        <Skeleton width="min(200px, 45%)" height="34px" radius="10px" style={{ marginTop: 10 }} />
        <Skeleton width="min(300px, 75%)" height="14px" style={{ marginTop: 14 }} />
      </section>

      <Skeleton height="56px" radius="16px" style={{ margin: "22px 0" }} />

      <section className="dashboard-balance-card" aria-hidden="true">
        <Skeleton width="170px" height="12px" radius="6px" />
        <div className="dashboard-balance-grid" style={{ marginTop: 16 }}>
          {[1, 2].map((item) => (
            <div className="dashboard-balance-tile" key={item}>
              <Skeleton width="90px" height="12px" radius="6px" />
              <Skeleton width="70%" height="28px" radius="8px" style={{ marginTop: 12 }} />
            </div>
          ))}
        </div>
        <div className="dashboard-balance-footer">
          <Skeleton width="150px" height="12px" radius="6px" />
          <Skeleton width="110px" height="12px" radius="6px" />
        </div>
      </section>

      <section className="dashboard-section dashboard-recent-groups" aria-hidden="true">
        <div className="dashboard-section-header">
          <Skeleton width="150px" height="22px" radius="8px" />
          <Skeleton width="50px" height="14px" radius="6px" />
        </div>
        <div className="groups-scroll">
          {[1, 2, 3, 4].map((item) => (
            <div className="group-card" key={item}>
              <Skeleton width="48px" height="48px" radius="14px" />
              <Skeleton width="70%" height="18px" style={{ marginTop: 18 }} />
              <Skeleton width="45%" height="12px" style={{ marginTop: 8 }} />
              <Skeleton width="55%" height="12px" style={{ marginTop: 18 }} />
              <Skeleton width="65%" height="26px" radius="8px" style={{ marginTop: 8 }} />
              <Skeleton width="50%" height="11px" style={{ marginTop: 8 }} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
