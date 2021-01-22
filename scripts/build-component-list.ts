import { JSDOM } from 'jsdom';

class ComponentListBuilder {
    public async run() {
        const dom = await JSDOM.fromURL('https://developer.roku.com/docs/references/brightscript/language/brightscript-language-reference.md');
        const componentsElement = [...dom.window.document.getElementsByClassName('doc-nav-title')].filter(x => x.innerHTML.toLowerCase() === 'components')[0];
        console.log(componentsElement);
    }

    public buildRoSGNodeList() {
        const asdf = this.httpGet('https://devtools.web.roku.com/schema/RokuSceneGraph.xsd');
    }

    public async httpGet(url: string) {
        const dom = new JSDOM('');
        const response = await dom.window.fetch(url);
        return response.text();
    }
}

//run the builder
new ComponentListBuilder().run().catch((e) => console.error(e));
