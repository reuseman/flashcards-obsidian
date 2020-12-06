export class Settings {
    public contextAwareMode: boolean = true
    public contextSeparator: string = ' > '

    public deck: string = "Default"
    private _flashcardsTag: string = "card"

    public get flashcardsTag() {
        return this._flashcardsTag
    }

    public set flashcardsTag(tag: string) {
        if (tag.length < 1) {
            throw new Error("The tag must be at least of length 1.")
        }
        this._flashcardsTag = tag
    }
}