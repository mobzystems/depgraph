import { Child, Command } from "@tauri-apps/api/shell";

export type BackendServiceState = 'stopped' | 'started' | 'running';

export class BackendService {
    private static state: BackendServiceState = 'stopped';
    private static process: Child | undefined = undefined;

    /***
     * Start the service at the supplied url (passed as --urls argument)
     * Can only be called when state === 'stopped' and process is undefined
     * Returns new state: either 'started' if successful, or 'stopped' if not
     */
    static async start(url: string) {
        console.log(`Starting service, state is ${this.state}`);
        if (this.state !== 'stopped' || this.process !== undefined)
            return this.state;

        // Change state ASAP to prevent others starting another instance with us
        this.state = 'started';

        try {
            const command = new Command('services', ['--urls', url]);
            const process = await command.spawn();

            this.process = process;

            console.log(`BackendService: process #${process.pid} started`);
        }
        catch (error: any) {
            this.state = 'stopped';
            
            console.log(`BackendService: failed to start process: '${error}'`);
        }

        return this.state;
    }

    /***
     * Wait until a test URL returns an OK response
     * Can only be called when state === 'started'.
     * Sets state to 'running' when done, or 'stopped' if failed after retries
    */
    static async waitUntilReady(testUrl: string) {
        if (this.state !== 'started')
            return this.state;

        const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
        let success = false;
        for (let count = 0; count < 10; count++) {
            try {
                const response = await fetch(testUrl);
                if (response.ok) {
                    success = true;
                    break;
                }
            }
            catch (error: any) {
                console.log(`BackendService: test URL error '${error}'`);
            }
            console.log(`BackendService: waiting for server... (${count + 1})`);
            await sleep(500);
        }
        if (success) {
            // await sleep(5000); // For testing
            console.log(`BackendService: service started successfully`);
            this.state = 'running';
        } else {
            console.log(`BackendService: service was NOT started successfully`);
            await this.stop();
        }
        return this.state;
    }

    /***
     * Stops the service. Can only be called when state === 'stopped' AND the process is undefined
     * Sets state to 'stopped' and process to undefined, even on error
     */
    static async stop() {
        if (this.state === 'stopped' || this.process === undefined)
            return this.state;

        try {
            await this.process?.kill();
            console.log(`BackendService: stopped process #${this.process.pid}`);
        }
        catch (error: any) {
            console.log(`BackendService: error stopping process #${this.process.pid}`);
        }

        this.state = 'stopped';
        this.process = undefined;

        return this.state;
    }
}
