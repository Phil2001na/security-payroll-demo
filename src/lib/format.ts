// Namibian Dollar formatting + general helpers.
const nadFormatter = new Intl.NumberFormat("en-NA", {
  style: "currency",
  currency: "NAD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const formatNAD = (value: number | null | undefined) => {
  if (value == null || Number.isNaN(value)) return "—";
  return nadFormatter.format(value);
};

export const formatNumber = (value: number | null | undefined, digits = 2) => {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-NA", { minimumFractionDigits: digits, maximumFractionDigits: digits });
};

export const formatDate = (value: string | Date | null | undefined) => {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

export const formatDateTime = (value: string | Date | null | undefined) => {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
};

export const initials = (name: string | null | undefined) => {
  if (!name) return "??";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
};
