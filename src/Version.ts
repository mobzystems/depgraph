export class Version
{
    public major: number;
    public minor: number;
    public revision: number;

    constructor(versionString: string) {
        let [major, minor, revision] = versionString.split('.');
        this.major = parseInt(major);
        this.minor = parseInt(minor);
        this.revision = parseInt(revision);
    }

    public value() {
        return 1000 * (1000 * this.major + this.minor) + this.revision;
    } 
}