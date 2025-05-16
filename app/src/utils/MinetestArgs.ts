class MinetestArgs {
    go: boolean;
    server: boolean;
    name: string;
    password: string;
    gameid: string;
    address: string;
    port: number;
    worldname: string;
    packs: string[];
    extra: string[];

    constructor() {
        this.go = false;
        this.server = false;
        this.name = '';
        this.password = '';
        this.gameid = '';
        this.address = '';
        this.port = 0;
        this.worldname = '';
        this.packs = [];
        this.extra = [];
    }

    toArray() {
        const args = [];
        if (this.go) args.push('--go');
        if (this.server) args.push('--server');
        if (this.name) args.push('--name', this.name);
        if (this.password) args.push('--password', this.password);
        if (this.gameid) args.push('--gameid', this.gameid);
        if (this.address) args.push('--address', this.address);
        if (this.port) args.push('--port', this.port.toString());
        if (this.worldname) args.push('--worldname', this.worldname); // `"${this.worldname}"`
        args.push(...this.extra);
        return args;
    }

    clear() {
        this.go = false;
        this.server = false;
        this.name = '';
        this.password = '';
        this.gameid = '';
        this.address = '';
        this.port = 0;
        this.worldname = '';
        this.packs = [];
        this.extra = [];
    }

    toJSON() {
        return JSON.stringify(this);
    }

    static fromJSON(json: string) {
        const parsed = JSON.parse(json);
        const args = new MinetestArgs();
        Object.assign(args, parsed);
        return args;
    }
}

export default MinetestArgs;