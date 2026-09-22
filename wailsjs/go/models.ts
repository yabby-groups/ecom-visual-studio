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
	export class chatAction {
	    type: string;
	    summary: string;
	    payload: Record<string, any>;

	    static createFrom(source: any = {}) {
	        return new chatAction(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.summary = source["summary"];
	        this.payload = source["payload"];
	    }
	}
	export class chatResult {
	    text: string;
	    actions: chatAction[];

	    static createFrom(source: any = {}) {
	        return new chatResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.text = source["text"];
	        this.actions = this.convertValues(source["actions"], chatAction);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class deviceAuthorization {
	    device_code: string;
	    user_code: string;
	    verification_uri: string;
	    verification_uri_complete: string;
	    expires_in: number;
	    interval: number;

	    static createFrom(source: any = {}) {
	        return new deviceAuthorization(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.device_code = source["device_code"];
	        this.user_code = source["user_code"];
	        this.verification_uri = source["verification_uri"];
	        this.verification_uri_complete = source["verification_uri_complete"];
	        this.expires_in = source["expires_in"];
	        this.interval = source["interval"];
	    }
	}

}
