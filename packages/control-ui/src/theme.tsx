import { createContext, useContext } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { ControlUiTheme } from "./types";
import { cx } from "./utils";

type ThemeStyle = CSSProperties &
	Record<`--vdsp-control-ui-${string}`, string | number | undefined>;

const ControlUiThemeContext = createContext<ControlUiTheme>({});

export type ControlUiThemeProviderProps = Readonly<{
	theme: ControlUiTheme;
	className?: string | undefined;
	style?: CSSProperties | undefined;
	children: ReactNode;
}>;

export function ControlUiThemeProvider({
	theme,
	className,
	style,
	children,
}: ControlUiThemeProviderProps) {
	const themeStyle: ThemeStyle = {
		...style,
		...themeToCssVariables(theme),
	};

	return (
		<ControlUiThemeContext.Provider value={theme}>
			<div
				className={cx("vdsp-control-ui-theme", className)}
				style={themeStyle}
			>
				{children}
			</div>
		</ControlUiThemeContext.Provider>
	);
}

export function useControlUiTheme(): ControlUiTheme {
	return useContext(ControlUiThemeContext);
}

export function themeToCssVariables(theme: ControlUiTheme): ThemeStyle {
	return {
		...(theme.accentColor === undefined
			? {}
			: { "--vdsp-control-ui-accent-color": theme.accentColor }),
		...(theme.backgroundColor === undefined
			? {}
			: { "--vdsp-control-ui-background-color": theme.backgroundColor }),
		...(theme.borderColor === undefined
			? {}
			: { "--vdsp-control-ui-border-color": theme.borderColor }),
		...(theme.controlColor === undefined
			? {}
			: { "--vdsp-control-ui-control-color": theme.controlColor }),
		...(theme.textColor === undefined
			? {}
			: { "--vdsp-control-ui-text-color": theme.textColor }),
		...(theme.mutedTextColor === undefined
			? {}
			: { "--vdsp-control-ui-muted-text-color": theme.mutedTextColor }),
		...(theme.focusRingColor === undefined
			? {}
			: { "--vdsp-control-ui-focus-ring-color": theme.focusRingColor }),
	};
}
