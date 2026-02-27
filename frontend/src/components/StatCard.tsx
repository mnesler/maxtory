// StatCard component

interface Props {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}

export function StatCard(props: Props) {
  return (
    <div class="stat-card">
      <div class="stat-label">{props.label}</div>
      <div
        class="stat-value"
        style={props.color ? `color:${props.color}` : ""}
      >
        {props.value}
      </div>
      {props.sub && <div class="stat-sub">{props.sub}</div>}
    </div>
  );
}
