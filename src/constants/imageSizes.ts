export const nativeImageRatios = [
  { ratio: "3:1", label: "超宽", size: "2016×672" },
  { ratio: "21:9", label: "宽幅", size: "2016×864" },
  { ratio: "16:9", label: "宽屏", size: "1536×864" },
  { ratio: "3:2", label: "横图", size: "1536×1024" },
  { ratio: "4:3", label: "横图", size: "1536×1152" },
  { ratio: "5:4", label: "横图", size: "1280×1024" },
  { ratio: "1:1", label: "方图", size: "1024×1024" },
  { ratio: "4:5", label: "竖图", size: "1024×1280" },
  { ratio: "3:4", label: "竖图", size: "1152×1536" },
  { ratio: "2:3", label: "竖图", size: "1024×1536" },
  { ratio: "9:16", label: "竖屏", size: "864×1536" },
  { ratio: "1:3", label: "长图", size: "672×2016" },
] as const;

export function customImageSize(value: string): [number, number] | null {
  const match = /^(\d+)x(\d+)$/.exec(value);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

export function imageSizeError(width: number, height: number): string {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  )
    return "请输入有效的宽度和高度";
  if (width % 16 || height % 16) return "宽度和高度必须是 16 的倍数";
  if (width > 3840 || height > 3840) return "单边不能超过 3840 像素";
  if (width > height * 3 || height > width * 3)
    return "比例须在 1:3 至 3:1 之间";
  if (width * height < 655360 || width * height > 8294400)
    return "总像素须在 655,360 至 8,294,400 之间";
  return "";
}

export function imageRatioLabel(value: string): string {
  const size = customImageSize(value);
  if (!size) return value;
  let [a, b] = size;
  while (b) [a, b] = [b, a % b];
  return `${size[0] / a}:${size[1] / a}`;
}
