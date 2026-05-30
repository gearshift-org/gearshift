import {
  getIconForDirectoryPath,
  getIconForFilePath,
  getIconUrlByName,
  type MaterialIcon,
} from "vscode-material-icons";

const ICONS_URL_PREFIX = "material-icons://";
const DEFAULT_FILE_ICON: MaterialIcon = "file";
const DEFAULT_FOLDER_ICON: MaterialIcon = "folder";
const DEFAULT_OPEN_FOLDER_ICON: MaterialIcon = "folder-open";

const FILE_ICON_OVERRIDES: Record<string, MaterialIcon> = {
  "bun.lock": "bun",
  "cargo.lock": "rust",
  "gemfile.lock": "gemfile",
  rakefile: "gemfile",
  "rollup.config.cjs": "rollup",
};

const EXTENSION_ICON_OVERRIDES: Record<string, MaterialIcon> = {
  aac: "audio",
  apng: "image",
  cjs: "javascript",
  hrl: "erlang",
  lock: "nodejs",
  m: "c",
  mm: "cpp",
  oga: "audio",
  opus: "audio",
  php: "php",
  phtml: "php",
  postcss: "postcss",
  pyi: "python",
  pyw: "python",
  yaml: "yaml",
  yml: "yaml",
};

const iconUrls = import.meta.glob(
  "/node_modules/vscode-material-icons/generated/icons/*.svg",
  {
    eager: true,
    import: "default",
    query: "?url",
  },
) as Record<string, string>;

const iconUrlsByName = Object.fromEntries(
  Object.entries(iconUrls).map(([path, url]) => [
    path.split("/").pop()?.replace(/\.svg$/, "") ?? "",
    url,
  ]),
) as Partial<Record<MaterialIcon, string>>;

function getIconUrl(iconName: MaterialIcon, fallbackIconName: MaterialIcon): string {
  return (
    iconUrlsByName[iconName] ??
    iconUrlsByName[fallbackIconName] ??
    getIconUrlByName(fallbackIconName, ICONS_URL_PREFIX)
  );
}

export function getFileIconUrl(fileName: string): string {
  const normalizedFileName = fileName.toLowerCase();
  const overrideIcon = FILE_ICON_OVERRIDES[normalizedFileName];

  if (overrideIcon) {
    return getIconUrl(overrideIcon, DEFAULT_FILE_ICON);
  }

  const extension = normalizedFileName.split(".").pop();
  const extensionOverrideIcon = extension
    ? EXTENSION_ICON_OVERRIDES[extension]
    : undefined;

  return getIconUrl(
    extensionOverrideIcon ?? getIconForFilePath(fileName),
    DEFAULT_FILE_ICON,
  );
}

export function getFolderIconUrl(folderName: string, open: boolean): string {
  const iconName = getIconForDirectoryPath(folderName);
  const openIconName = `${iconName}-open`;

  if (open && openIconName in iconUrlsByName) {
    return getIconUrl(openIconName as MaterialIcon, DEFAULT_OPEN_FOLDER_ICON);
  }

  return getIconUrl(iconName, open ? DEFAULT_OPEN_FOLDER_ICON : DEFAULT_FOLDER_ICON);
}
