export declare const checkPortAvailable: (port: number, host?: string) => Promise<boolean>;
/**
 * @description check whether port is idle and then return another idle port if the port pass in is unavailable
 */
export declare const getAvailablePort: (port: number) => any;
export declare function padRight(str: string, length: number, padStr?: string): string;
export declare function padLeft(str: string, length: number, padStr?: string): string;
