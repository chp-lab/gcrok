type Color = 'success' | 'error' | 'info' | 'warn' | 'white' | 'bgWhite' | 'cyan' | 'bgCyan' | 'black' | 'bgBlack' | 'red' | 'bgRed' | 'purple' | 'bgPurple' | 'blue' | 'bgBlue' | 'pink' | 'bgPink' | 'green' | 'bgGreen' | 'yellow' | 'bgYellow' | 'orange' | 'bgOrange' | 'gray' | 'bgGray' | 'mint' | 'bgMint';
type ChainLogger = Record<Color, (content: any) => ChainLogger> & {
    endLine: () => void;
};
type Logger = Record<Color, (content: any, options?: {
    newLine?: boolean;
}) => void> & {
    /** log one line */
    line: (logs: {
        type?: Color;
        content: any;
    }[]) => void;
    startLine: () => ChainLogger;
    lineGradient: (content: string) => void;
};
declare const logger: Logger;
export default logger;
