export namespace main {
	
	export class AssetPatch {
	    title: string;
	    template: string;
	    ratio: string;
	    prompt: string;
	
	    static createFrom(source: any = {}) {
	        return new AssetPatch(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.title = source["title"];
	        this.template = source["template"];
	        this.ratio = source["ratio"];
	        this.prompt = source["prompt"];
	    }
	}
	export class PackInput {
	    kind: string;
	    scene_template_ids: string[];
	    template_id: string;
	
	    static createFrom(source: any = {}) {
	        return new PackInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.scene_template_ids = source["scene_template_ids"];
	        this.template_id = source["template_id"];
	    }
	}
	export class ProjectInput {
	    name: string;
	    product: string;
	    description: string;
	    benefits: string;
	    color: string;
	    reference: string;
	
	    static createFrom(source: any = {}) {
	        return new ProjectInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.product = source["product"];
	        this.description = source["description"];
	        this.benefits = source["benefits"];
	        this.color = source["color"];
	        this.reference = source["reference"];
	    }
	}
	export class SettingsInput {
	    token_id: string;
	    image_model: string;
	    text_model: string;
	    chat_model: string;
	
	    static createFrom(source: any = {}) {
	        return new SettingsInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.token_id = source["token_id"];
	        this.image_model = source["image_model"];
	        this.text_model = source["text_model"];
	        this.chat_model = source["chat_model"];
	    }
	}
	export class TemplateInput {
	    name: string;
	    ratio: string;
	    direction: string;
	
	    static createFrom(source: any = {}) {
	        return new TemplateInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.ratio = source["ratio"];
	        this.direction = source["direction"];
	    }
	}
	export class TryOnInput {
	    person_paths: string[];
	    garment_paths: string[];
	    generation_mode: string;
	    instructions: string;
	    ratio: string;
	
	    static createFrom(source: any = {}) {
	        return new TryOnInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.person_paths = source["person_paths"];
	        this.garment_paths = source["garment_paths"];
	        this.generation_mode = source["generation_mode"];
	        this.instructions = source["instructions"];
	        this.ratio = source["ratio"];
	    }
	}

}

