export type TokenLocale = "zh" | "en";
export interface TokenFormatOptions {
  locale?: TokenLocale;
  compact?: boolean;
  decimals?: number;
  withUnitSuffix?: boolean;
}

const trimNumber = (value: number, decimals: number): string =>
  value.toFixed(decimals).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");

export function formatTokenAmount(value: number, options: TokenFormatOptions = {}): string {
  const locale = options.locale ?? "en";
  const compact = options.compact ?? true;
  const decimals = options.decimals ?? 2;
  if (!compact) {
    const raw = value.toLocaleString(locale === "zh" ? "zh-CN" : "en-US");
    return options.withUnitSuffix ? `${raw} Token` : raw;
  }
  const absolute = Math.abs(value);
  let result: string;
  if (locale === "zh") {
    if (absolute >= 1_000_000_000_000) result = `${trimNumber(value / 1_000_000_000_000, decimals)}万亿`;
    else if (absolute >= 100_000_000) result = `${trimNumber(value / 100_000_000, decimals)}亿`;
    else if (absolute >= 10_000) result = `${trimNumber(value / 10_000, decimals)}万`;
    else result = value.toLocaleString("zh-CN");
  } else if (absolute >= 1_000_000_000_000) result = `${trimNumber(value / 1_000_000_000_000, decimals)}T`;
  else if (absolute >= 1_000_000_000) result = `${trimNumber(value / 1_000_000_000, decimals)}B`;
  else if (absolute >= 1_000_000) result = `${trimNumber(value / 1_000_000, decimals)}M`;
  else if (absolute >= 1_000) result = `${trimNumber(value / 1_000, decimals)}K`;
  else result = value.toLocaleString("en-US");
  return options.withUnitSuffix ? `${result} Token` : result;
}

export function formatTokenDetail(value: number, locale: TokenLocale = "en"): string {
  return `${formatTokenAmount(value, { locale })} (${formatTokenAmount(value, { locale, compact: false, withUnitSuffix: true })})`;
}
