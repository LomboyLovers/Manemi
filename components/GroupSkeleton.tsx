import Skeleton from "./skeleton";
import "./groups-skeleton.css";

export default function GroupsSkeleton() {
  return (
    <div
      className="groups-skeleton-page"
      role="status"
      aria-label="Loading groups"
    >
      {/* HEADER */}
      <div className="gs-header">
        <div className="gs-avatar manemi-skeleton" />

        <div className="gs-header-actions">
          <div className="gs-header-circle manemi-skeleton" />
          <div className="gs-header-circle manemi-skeleton" />
          <div className="gs-header-circle manemi-skeleton" />
        </div>
      </div>

      {/* GROUPS TITLE AND DESCRIPTION */}
      <div className="gs-heading">
        <div className="gs-heading-title manemi-skeleton" />
        <div className="gs-heading-description manemi-skeleton" />
      </div>

      {/* GLOBAL BALANCES */}
      <section className="gs-balances">
        <Skeleton width="145px" height="12px" radius="5px" />

        <div className="gs-balance-grid">
          {[1, 2].map((item) => (
            <div className="gs-balance-card" key={item}>
              <Skeleton width="95px" height="11px" />
              <Skeleton width="110px" height="29px" style={{ marginTop: 10 }} />
              <Skeleton width="75px" height="10px" style={{ marginTop: 8 }} />
            </div>
          ))}
        </div>

        <Skeleton width="65%" height="10px" style={{ marginTop: 12 }} />
      </section>

      {/* CATEGORY FILTERS */}
      <div className="gs-categories">
        {[45, 68, 105, 116, 74, 65].map((width, index) => (
          <Skeleton
            key={index}
            width={`${width}px`}
            height="34px"
            radius="20px"
          />
        ))}
      </div>

      {/* SEARCH BAR */}
      <div className="gs-search">
        <Skeleton width="18px" height="18px" radius="50%" />
        <Skeleton width="145px" height="12px" />
      </div>

      {/* ACTIVE GROUP COUNT */}
      <div className="gs-active-count">
        <Skeleton width="85px" height="12px" />
      </div>

      {/* GROUP CARDS */}
      <div className="gs-groups-grid">
        {[1, 2, 3, 4, 5, 6].map((item) => (
          <article className="gs-group-card" key={item}>
            <div className="gs-card-top">
              <Skeleton width="40px" height="40px" radius="12px" />
              <Skeleton width="22px" height="12px" radius="6px" />
            </div>

            <div className="gs-card-title">
              <Skeleton width="65%" height="19px" />
              <Skeleton width="50%" height="10px" style={{ marginTop: 7 }} />
            </div>

            <div className="gs-card-balance">
              <Skeleton width="115px" height="10px" />
              <Skeleton width="95px" height="25px" style={{ marginTop: 9 }} />
              <Skeleton width="130px" height="10px" style={{ marginTop: 7 }} />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
