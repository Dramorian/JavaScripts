// ==UserScript==
// @name         RecentTagsCalc
// @namespace    https://github.com/BrokenEagle/JavaScripts
// @version      7.4
// @description  Use different mechanism to calculate RecentTags.
// @source       https://danbooru.donmai.us/users/23799
// @author       BrokenEagle
// @match        *://*.donmai.us/uploads/new*
// @match        *://*.donmai.us/posts/*
// @match        *://*.donmai.us/settings
// @exclude      /^https?://\w+\.donmai\.us/.*\.(xml|json|atom)(\?|$)/
// @grant        none
// @run-at       document-end
// @downloadURL  https://raw.githubusercontent.com/BrokenEagle/JavaScripts/stable/recenttagscalc.user.js
// @require      https://cdn.jsdelivr.net/npm/core-js-bundle@3.2.1/minified.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/localforage/1.5.2/localforage.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/validate.js/0.12.0/validate.min.js
// @require      https://raw.githubusercontent.com/BrokenEagle/JavaScripts/20200505/lib/debug.js
// @require      https://raw.githubusercontent.com/BrokenEagle/JavaScripts/20200505/lib/load.js
// @require      https://raw.githubusercontent.com/BrokenEagle/JavaScripts/20200505/lib/utility.js
// @require      https://raw.githubusercontent.com/BrokenEagle/JavaScripts/20200505/lib/statistics.js
// @require      https://raw.githubusercontent.com/BrokenEagle/JavaScripts/20200505/lib/storage.js
// @require      https://raw.githubusercontent.com/BrokenEagle/JavaScripts/20200505/lib/concurrency.js
// @require      https://raw.githubusercontent.com/BrokenEagle/JavaScripts/20200505/lib/validate.js
// @require      https://raw.githubusercontent.com/BrokenEagle/JavaScripts/20200505/lib/network.js
// @require      https://raw.githubusercontent.com/BrokenEagle/JavaScripts/20200505/lib/danbooru.js
// @require      https://raw.githubusercontent.com/BrokenEagle/JavaScripts/20200505/lib/menu.js
// ==/UserScript==

/* global JSPLib $ Danbooru */

/****Global variables****/

//Library constants

////NONE

//Exterior script variables
const DANBOORU_TOPIC_ID = '15851';
const JQUERY_TAB_WIDGET_URL = 'https://cdn.jsdelivr.net/gh/jquery/jquery-ui@1.12.1/ui/widgets/tabs.js';

//Variables for load.js
const program_load_required_variables = ['window.jQuery','window.Danbooru'];
const program_load_required_selectors = ['#page'];

//Program name constants
const PROGRAM_SHORTCUT = 'rtc';
const PROGRAM_CLICK = 'click.rtc';
const PROGRAM_NAME = 'RecentTagsCalc';

//Program data constants
const PROGRAM_DATA_REGEX = /^(ta|tag)-/; //Regex that matches the prefix of all program cache data
const PROGRAM_DATA_KEY = {
    tag_data: 'tag',
    tag_alias: 'ta'
};

//Main program variable
var RTC;

//Timer function hash
const Timer = {};

//For factory reset
const localstorage_keys = [
    'rtc-pinned-tags',
    'rtc-recent-tags',
    'rtc-other-recent',
    'rtc-frequent-tags',
    'rtc-frequent-tags-expires',
    'rtc-was-upload',
];
const PROGRAM_RESET_KEYS = {
    pinned_tags: [],
    recent_tags: [],
    other_recent: [],
    frequent_tags: [],
    tag_data: {},
};

const order_types = ['alphabetic','form_order','post_count','category','tag_usage'];
const category_orders = ['general','artist','copyright','character','meta','alias','metatag'];
const list_types = ['queue','single','multiple'];
const disabled_order_types = ['tag_usage'];

const SETTINGS_CONFIG = {
    uploads_order: {
        allitems: order_types,
        default: ['form_order'],
        validate: (data)=>{return Array.isArray(data) && data.length === 1 && order_types.includes(data[0])},
        hint: "Select the type of order to be applied on recent tags from an upload."
    },
    post_edits_order: {
        allitems: order_types,
        default: ['alphabetic'],
        validate: (data)=>{return Array.isArray(data) && data.length === 1 && order_types.includes(data[0])},
        hint: "Select the type of order to be applied on recent tags from a post edit."
    },
    metatags_first: {
        default: true,
        validate: (data)=>{return typeof data === "boolean";},
        hint: "Sets the post count high for metatags. Only effective with the <b>Post Count</b> order type."
    },
    aliases_first: {
        default: true,
        validate: (data)=>{return typeof data === "boolean";},
        hint: "Sets the post count high for aliases. Only effective with the <b>Post Count</b> order type."
    },
    category_order: {
        allitems: category_orders,
        default: category_orders,
        validate: (data)=>{return Array.isArray(data) && JSPLib.utility.setSymmetricDifference(data,category_orders).length === 0},
        hint: "Drag and drop the categories to determine the group order for the <b>Category</b> order type."
    },
    list_type: {
        allitems: list_types,
        default: ['queue'],
        validate: (data)=>{return Array.isArray(data) && data.length === 1 && list_types.includes(data[0])},
        hint: "Select how to store tags after each upload/edit."
    },
    maximum_tags: {
        default: 25,
        parse: parseInt,
        validate: (data)=>{return Number.isInteger(data) && data > 0;},
        hint: "The number of recent tags to store and show."
    },
    maximum_tag_groups: {
        default: 5,
        parse: parseInt,
        validate: (data)=>{return Number.isInteger(data) && data > 0;},
        hint: "Number of recent tag groups to store and show. Only affects the <b>Multiple</b> list type."
    },
    include_metatags: {
        default: true,
        validate: (data)=>{return typeof data === "boolean";},
        hint: "Does not filter out metatags."
    },
    include_unchanged_tags: {
        default: true,
        validate: (data)=>{return typeof data === "boolean";},
        hint: "Does not filter out unchanged tags."
    },
    include_removed_tags: {
        default: false,
        validate: (data)=>{return typeof data === "boolean";},
        hint: "Does not filter out removed tags."
    },
    include_deleted_tags: {
        default: false,
        validate: (data)=>{return typeof data === "boolean";},
        hint: "Does not filter out unaliased tags with a post count of 0."
    },
    cache_frequent_tags: {
        default: true,
        validate: (data)=>{return typeof data === "boolean";},
        hint: "Saves the user's favorite tags locally."
    }
};

const all_source_types = ['indexed_db','local_storage'];
const all_data_types = ['tag_data', 'tag_alias', 'custom'];

const CONTROL_CONFIG = {
    refresh_frequent_tags: {
        value: "Click to refresh",
        hint: "Gets the latest favorite tags from the user's profile.",
    },
    cache_info: {
        value: "Click to populate",
        hint: "Calculates the cache usage of the program and compares it to the total usage.",
    },
    purge_cache: {
        display: `Purge cache (<span id="${PROGRAM_SHORTCUT}-purge-counter">...</span>)`,
        value: "Click to purge",
        hint: `Dumps all of the cached data related to ${PROGRAM_NAME}.`,
    },
    data_source: {
        allitems: all_source_types,
        value: 'indexed_db',
        hint: "Indexed DB is <b>Cache Data</b> and Local Storage is <b>Program Data</b>.",
    },
    data_type: {
        allitems: all_data_types,
        value: 'tag',
        hint: "Select type of data. Use <b>Custom</b> for querying by keyname.",
    },
    raw_data: {
        value: false,
        hint: "Select to import/export all program data",
    },
    data_name: {
        value: "",
        buttons: ['get', 'save', 'delete'],
        hint: "Click <b>Get</b> to see the data, <b>Save</b> to edit it, and <b>Delete</b> to remove it.",
    },
};

//Misc tag categories
const alias_tag_category = 100;
const deleted_tag_category = 200;
const notfound_tag_category = 300;
const metatags_category = 400;
const category_name = {
    0: "general",
    1: "artist",
    3: "copyright",
    4: "character",
    5: "meta",
    [alias_tag_category]: "alias",
    [metatags_category]: "metatag",
    [deleted_tag_category]: "deleted"
};

//CSS Constants
let program_css = `
.rtc-user-related-tags-columns {
    display: flex;
}
.tag-type-${metatags_category} a:link,
.tag-type-${metatags_category} a:visited {
    color: darkgoldenrod;
    font-weight: bold;
}
.tag-type-${metatags_category} a:hover {
    color: goldenrod;
    font-weight: bold;
}
.tag-type-${alias_tag_category} a:link,
.tag-type-${alias_tag_category} a:visited {
    color: #0CC;
    font-weight: bold;
}
.tag-type-${alias_tag_category} a:hover {
    color: aqua;
    font-weight: bold;
}
.tag-type-${deleted_tag_category} a:link,
.tag-type-${deleted_tag_category} a:visited {
    color: black;
    background-color: red;
    font-weight: bold;
}
.tag-type-${deleted_tag_category} a:hover {
    color: black;
    background-color: white;
    font-weight: bold;
}
.tag-type-${notfound_tag_category} a {
    text-decoration: underline dotted grey;
}
`;

const MENU_CSS = `
#recent-tags-calc .jsplib-sortlist li {
    width: 120px;
}
`;

//HTML Constants

const usertag_columns_html = `
<div class="tag-column recent-related-tags-column is-empty-false"></div>
<div class="tag-column frequent-related-tags-column is-empty-false"></div>`;

const CACHE_INFO_TABLE = '<div id="rtc-cache-info-table" style="display:none"></div>';

const rtc_menu = `
<div id="rtc-script-message" class="prose">
    <h2>${PROGRAM_NAME}</h2>
    <p>Check the forum for the latest on information and updates (<a class="dtext-link dtext-id-link dtext-forum-topic-id-link" href="/forum_topics/${DANBOORU_TOPIC_ID}">topic #${DANBOORU_TOPIC_ID}</a>).</p>
</div>
<div id="cu-console" class="jsplib-console">
    <div id="rtc-settings" class="jsplib-outer-menu">
        <div id="rtc-general-settings" class="jsplib-settings-grouping">
            <div id="rtc-general-message" class="prose">
                <h4>General settings</h4>
            </div>
        </div>
        <div id="rtc-order-settings" class="jsplib-settings-grouping">
            <div id="rtc-order-message" class="prose">
                <h4>Order settings</h4>
                <div class="expandable">
                    <div class="expandable-header">
                        <span>Additional setting details</span>
                        <input type="button" value="Show" class="expandable-button">
                    </div>
                    <div class="expandable-content">
                        <ul>
                            <li>Order types: for <b>Uploads Order</b> and <b>Post Edits Order</b>
                                <ul>
                                    <li><b>Alphabetic:</b> A to Z.</li>
                                    <li><b>Form order:</b> The order of tags in the tag edit box.</li>
                                    <li><b>Post count:</b> Highest to lowest.
                                        <ul>
                                            <li>Metatags are rated higher than aliases.</li>
                                            <li>Only when both <b>Metatags First</b> and <b>Aliases First</b> are set.</li>
                                        </ul>
                                    </li>
                                    <li><b>Category:</b> Tag category.</li>
                                    <li><b>Tag usage:</b> Ordered by recent tag usage.
                                        <ul>
                                            <li><i>Not implemented yet.</i></li>
                                        </ul>
                                    </li>
                                </ul>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
        <div id="rtc-list-settings" class="jsplib-settings-grouping">
            <div id="rtc-list-message" class="prose">
                <h4>List settings</h4>
                <div class="expandable">
                    <div class="expandable-header">
                        <span>Additional setting details</span>
                        <input type="button" value="Show" class="expandable-button">
                    </div>
                    <div class="expandable-content">
                        <ul>
                            <li><b>List type:</b>
                                <ul>
                                    <li><b>Queue:</b> First in, first out.</li>
                                    <li><b>Single:</b> Only the tags from the last upload/edit.</li>
                                    <li><b>Multiple:</b> Each upload/edit gets its own list.</li>
                                </ul>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
        <div id="rtc-inclusion-settings" class="jsplib-settings-grouping">
            <div id="rtc-inclusion-message" class="prose">
                <h4>Inclusion settings</h4>
                <div class="expandable">
                    <div class="expandable-header">
                        <span>Additional setting details</span>
                        <input type="button" value="Show" class="expandable-button">
                    </div>
                    <div class="expandable-content">
                        <ul>
                            <li><b>Include removed tags:</b>
                                <ul>
                                    <li>This includes both tags removed through deletion and through negative tags.</li>
                                    <li>When <b>Form Order</b> is being used, tag deletions get appended onto the new set of recent tags.</li>
                                </ul>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
        <div id="rtc-frequent-settings" class="jsplib-settings-grouping">
            <div id="rtc-frequent-message" class="prose">
                <h4>Frequent tags settings</h4>
                <div class="expandable">
                    <div class="expandable-header">
                        <span>Additional setting details</span>
                        <input type="button" value="Show" class="expandable-button">
                    </div>
                    <div class="expandable-content">
                        <ul>
                            <li><b>Cache frequent tags:</b>
                                <ul>
                                    <li>Makes for quicker loading of recent/frequent tags.</li>
                                    <li>Tags are automatically refreshed once a week.</li>
                                </ul>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
        <div id="rtc-cache-settings" class="jsplib-settings-grouping">
            <div id="rtc-cache-message" class="prose">
                <h4>Cache settings</h4>
                <div class="expandable">
                    <div class="expandable-header">
                        <span>Cache Data details</span>
                        <input type="button" value="Show" class="expandable-button">
                    </div>
                    <div class="expandable-content">
                        <ul>
                            <li><b>Tag data (tag):</b> Used to determine a tag's post count and category.</li>
                            <li><b>Tag aliases (ta):</b> Used to determine which tags are aliases or deleted.</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
        <hr>
        <div id="rtc-settings-buttons" class="jsplib-settings-buttons">
            <input type="button" id="rtc-commit" value="Save">
            <input type="button" id="rtc-resetall" value="Factory Reset">
        </div>
    </div>
    <div id="rtc-cache-editor" class="jsplib-outer-menu">
        <div id="rtc-editor-message" class="prose">
            <h4>Cache editor</h4>
            <p>See the <b><a href="#rtc-cache-message">Cache Data</a></b> details for the list of all cache data and what they do.</p>
            <div class="expandable">
                <div class="expandable-header">
                    <span>Program Data details</span>
                    <input type="button" value="Show" class="expandable-button">
                </div>
                <div class="expandable-content">
                    <p class="tn">All timestamps are in milliseconds since the epoch (<a href="https://www.epochconverter.com">Epoch converter</a>).</p>
                    <ul>
                        <li>General data
                            <ul>
                                <li><b>prune-expires:</b> When the program will next check for cache data that has expired.</li>
                                <li><b>user-settings:</b> All configurable settings.</li>
                            </ul>
                        </li>
                        <li>Recent tags
                            <ul>
                                <li><b>recent-tags:</b> The current list of recent tags.</li>
                                <li><b>pinned-tags:</b> The current list of pinned tags.</li>
                                <li>Used when the <b>Multiple</b> type list is selected:
                                    <ul>
                                        <li><b>other-recent:</b> Groups of the most recent tags used, set with the type of post event.</li>
                                        <li><b>was-upload:</b> Determines whether the current recent tags were from an upload or edit.</li>
                                    </ul>
                                </li>
                                <li><b>process-semaphore-recent:</b> Prevents two tabs from processing the same recent data at the same time.</li>
                            </ul>
                        </li>
                        <li>Frequent tags
                            <ul>
                                <li><b>frequent-tags:</b> List of all favorite tags from the user.</li>
                                <li><b>frequent-tags-expires:</b> When to next query the user's profile.</li>
                                <li><b>process-semaphore-frequent:</b> Prevents two tabs from processing the same frequency data at the same time.</li>
                            </ul>
                        </li>
                    </ul>
                </div>
            </div>
        </div>
        <div id="rtc-cache-editor-controls"></div>
        <div id="rtc-cache-editor-errors" class="jsplib-cache-editor-errors"></div>
        <div id="rtc-cache-viewer" class="jsplib-cache-viewer">
            <textarea></textarea>
        </div>
    </div>
</div>`;

//Expirations
const prune_expires = JSPLib.utility.one_day;
const noncritical_recheck = JSPLib.utility.one_minute;
const tag_expires = JSPLib.utility.one_week;
const tagalias_expires = JSPLib.utility.one_month;
const frequent_tags_expires = JSPLib.utility.one_week;
const process_semaphore_expires = JSPLib.utility.one_minute;

//Tag regexes
const negative_regex = /^-/;
const metatags_regex = /^(?:rating|-?parent|source|-?locked|-?pool|newpool|-?fav|child|-?favgroup|upvote|downvote):/i;
const striptype_regex = /^(-?)(?:general:|gen:|artist:|art:|copyright:|copy:|co:|character:|char:|ch:|meta:)?(.*)/i;

//For when new data has yet to be loaded by another tab
const default_tag_data = {
    category: notfound_tag_category,
    is_alias: false,
    is_deleted: false,
    postcount: 0
};

const deleted_tag_data = {
    category: deleted_tag_category,
    postcount: 0,
    is_alias: false,
    is_deleted: true
};

//Misc constants
const timer_poll_interval = 100;
const max_item_limit = 100;
const aliases_first_post_count = 1000000000;
const metatags_first_post_count = 2000000000;

const tag_fields = "id,name,category,post_count";
const user_fields = "favorite_tags";
const alias_fields = "consequent_name";

//Validation values

const relation_constraints = {
    entry: JSPLib.validate.arrayentry_constraints,
    value: JSPLib.validate.basic_stringonly_validator
};

const tag_constraints = {
    entry: JSPLib.validate.hashentry_constraints,
    value: {
        category: JSPLib.validate.inclusion_constraints([0,1,2,3,4,5,alias_tag_category,deleted_tag_category]),
        postcount: JSPLib.validate.counting_constraints,
        is_alias: JSPLib.validate.boolean_constraints,
        is_deleted: JSPLib.validate.boolean_constraints
    }
}

const other_recent_constraints = {
    tags: JSPLib.validate.array_constraints,
    was_upload: JSPLib.validate.boolean_constraints,
};

/****Functions****/

//Validation functions

function ValidateEntry(key,entry) {
    if (!JSPLib.validate.validateIsHash(key,entry)) {
        return false;
    }
    if (key.match(/^tag-/)) {
        return ValidateTagEntry(key,entry);
    } else if (key.match(/^ta-/)) {
        return ValidateRelationEntry(key,entry);
    }
    ValidateEntry.debuglog("Bad key!");
    return false;
}

function ValidateTagEntry(key,entry) {
    if (!JSPLib.validate.validateHashEntries(key, entry, tag_constraints.entry)) {
        return false;
    }
    if (!JSPLib.validate.validateHashEntries(key + '.value', entry.value, tag_constraints.value)) {
        return false;
    }
    return true;
}

function ValidateRelationEntry(key,entry) {
    if (!JSPLib.validate.validateHashEntries(key, entry, relation_constraints.entry)) {
        return false;
    }
    return JSPLib.validate.validateArrayValues(key + '.value', entry.value, relation_constraints.value);
}

function ValidateProgramData(key,entry) {
    var checkerror = [],maximum_validator;
    switch (key) {
        case 'rtc-user-settings':
            checkerror = JSPLib.menu.validateUserSettings(entry,SETTINGS_CONFIG);
            break;
        case 'rtc-prune-expires':
        case 'rtc-frequent-tags-expires':
        case 'rtc-process-semaphore-recent':
        case 'rtc-process-semaphore-frequent':
            if (!Number.isInteger(entry)) {
                checkerror = ["Value is not an integer."];
            }
            break;
        case 'rtc-was-upload':
            if (!JSPLib.validate.isBoolean(entry)) {
                checkerror = ['Value is not a boolean.'];
            }
            break;
        case 'rtc-recent-tags':
        case 'rtc-pinned-tags':
        case 'rtc-frequent-tags':
            maximum_validator = (key === 'rtc-recent-tags' ? {maximum: RTC.user_settings.maximum_tags} : undefined);
            if (!JSPLib.validate.validateIsArray(key,entry,maximum_validator)) {
                return false;
            }
            return JSPLib.validate.validateArrayValues(key,entry,JSPLib.validate.basic_stringonly_validator);
        case 'rtc-other-recent':
            if (!JSPLib.validate.validateIsArray(key,entry,{maximum: RTC.user_settings.maximum_tag_groups})) {
                return false;
            }
            for (let i = 0;i < entry.length; i++) {
                let entry_key = `${key}[${i}]`
                if (!JSPLib.validate.validateIsHash(entry_key,entry[i])) {
                    return false;
                }
                if (!JSPLib.validate.validateHashEntries(entry_key, entry[i], other_recent_constraints)) {
                    return false;
                }
                if (!JSPLib.validate.validateArrayValues(entry_key+'.tags',entry[i].tags,JSPLib.validate.basic_stringonly_validator)) {
                    return false;
                }
            }
            return true;
        default:
            checkerror = ["Not a valid program data key."];
    }
    if (checkerror.length) {
        JSPLib.validate.outputValidateError(key,checkerror);
        return false;
    }
    return true;
}

//Library functions

////NONE

//Auxiliary functions

function GetTagList() {
    return JSPLib.utility.filterEmpty(StripQuoteSourceMetatag($("#upload_tag_string,#post_tag_string").val()).split(/[\s\n]+/).map(tag=>{return tag.toLowerCase();}));
}

function StripQuoteSourceMetatag(str) {
    return str.replace(/source:"[^"]+"\s?/g,'');
}

function GetNegativetags(array) {
    return JSPLib.utility.filterRegex(array,negative_regex,false).map((value)=>{return value.substring(1);});
}

function FilterMetatags(array) {
    return JSPLib.utility.filterRegex(array,metatags_regex,true);
}

function NormalizeTags(array) {
    return array.map((entry)=>{return entry.replace(/^-/,'')});
}

function TransformTypetags(array) {
    return array.map((value)=>{return value.match(striptype_regex).splice(1).join('');});
}

function GetCurrentTags() {
    let tag_list = GetTagList();
    if (!RTC.user_settings.include_metatags) {
        tag_list = JSPLib.utility.filterRegex(GetTagList(),metatags_regex,true);
    }
    return TransformTypetags(tag_list);
}

function GetTagCategory(tag) {
    let tag_data = GetTagData(tag);
    if (!tag_data) {
        return 0;
    }
    return tag_data.category;
}

function GetTagData(tag) {
    if (tag.match(metatags_regex)) {
        let postcount = (RTC.user_settings.metatags_first ? metatags_first_post_count : 0)
        return {postcount:postcount,category:metatags_category};
    }
    if (!(tag in RTC.tag_data) || RTC.tag_data[tag].category === notfound_tag_category) {
        RTC.tag_data[tag] = JSPLib.storage.getStorageData('tag-'+tag,sessionStorage,{value:default_tag_data}).value;
    }
    if (RTC.tag_data[tag].is_alias) {
        RTC.tag_data[tag].category = alias_tag_category;
        RTC.tag_data[tag].postcount = (RTC.user_settings.aliases_first ? aliases_first_post_count : 0);
    } else if (RTC.tag_data[tag].is_deleted) {
        RTC.tag_data[tag].category = deleted_tag_category;
    }
    return RTC.tag_data[tag];
}

function GetTagColumnList(name) {
    if (name === "frequent") {
        return RTC.frequent_tags;
    } else if (name === "recent") {
        let all_tags = RTC.recent_tags;
        if (RTC.user_settings.list_type[0] === "multiple") {
            RTC.other_recent.forEach((recent_entry)=>{
                all_tags = JSPLib.utility.setUnion(all_tags,recent_entry.tags);
            });
        }
        return all_tags;
    }
    return [];
}

function ListTypeCheck() {
    if (RTC.user_settings.list_type[0] === "multiple") {
        RTC.other_recent = JSPLib.storage.checkStorageData('rtc-other-recent',ValidateProgramData,localStorage,[]);
    } else {
        localStorage.removeItem('rtc-other-recent');
        localStorage.removeItem('rtc-was-upload');
    }
}

function GetStartingTags() {
    return Object.keys(sessionStorage).filter(key => key.match(/^tag-/)).map(tag => tag.replace(/^tag-/, ''));
}

//Display functions

async function DisplayRecentTags() {
    await RTC.pageload_recentcheck;
    let $tag_column = $(".rtc-user-related-tags-columns .recent-related-tags-column");
    let html = RenderTaglist(RTC.recent_tags,"Recent",RTC.pinned_tags);
    if (RTC.user_settings.list_type[0] === "multiple") {
        let upload = 1, edit = 1;
        let shown_tags = JSPLib.utility.setUnion(RTC.recent_tags,RTC.pinned_tags);
        RTC.other_recent.forEach((recent_entry)=>{
            let title = (recent_entry.was_upload ? `Upload ${upload++}` : `Edit ${edit++}`);
            let display_tags = JSPLib.utility.setDifference(recent_entry.tags,shown_tags);
            if (display_tags.length) {
                html += RenderTaglist(display_tags,title,[]);
            }
            shown_tags = JSPLib.utility.setUnion(shown_tags,display_tags);
        });
    }
    $tag_column.html(html);
    $tag_column.removeClass("is-empty-true").addClass("is-empty-false");
    Danbooru.RelatedTag.update_selected();
    $(".recent-related-tags-column .ui-icon").on(PROGRAM_CLICK,PinnedTagsToggle);
}

async function DisplayFrequentTags() {
    await RTC.pageload_frequentcheck;
    let $tag_column = $(".rtc-user-related-tags-columns .frequent-related-tags-column");
    let html = RenderTaglist(RTC.frequent_tags,"Frequent");
    $tag_column.html(html);
    $tag_column.removeClass("is-empty-true").addClass("is-empty-false");
    Danbooru.RelatedTag.update_selected();
}

function RecheckAndDisplay(name) {
    JSPLib.storage.batchStorageCheck(FilterMetatags(GetTagColumnList(name)),ValidateEntry,tag_expires,'tag')
    .then(()=>{
        switch(name) {
            case "recent":
                DisplayRecentTags();
                break;
            case "frequent":
                DisplayFrequentTags();
                break;
            default:
                //do nothing
        }
    });
}

function RecheckDisplaySemaphore(name) {
    JSPLib.utility.recheckTimer({
        check: ()=>{return JSPLib.concurrency.checkSemaphore(PROGRAM_SHORTCUT, name);},
        exec: ()=>{
            RecheckDisplaySemaphore.debuglog("Callback:",name);
            RecheckAndDisplay(name);
        }
    },timer_poll_interval);
}

function RenderTaglines(taglist,addon) {
    return taglist.map((tag)=>{
        let category = GetTagCategory(tag);
        let search_link = JSPLib.danbooru.postSearchLink(tag,tag.replace(/_/g,' '),`class="search-tag"`);
        return `    <li class="tag-type-${category}">${addon}${search_link}</li>\n`;
    }).join('');
}

function RenderTaglist(taglist,columnname,pinned_tags) {
    let html = "";
    if (pinned_tags && pinned_tags.length) {
        html += RenderTaglines(pinned_tags,`<a class="ui-icon ui-icon-pin-s" style="min-width:unset"></a>&thinsp;`);
        taglist = JSPLib.utility.setDifference(taglist,pinned_tags);
    }
    let pin_html = (pinned_tags ? `<a class="ui-icon ui-icon-radio-off" style="min-width:unset"></a>&thinsp;` : '');
    html += RenderTaglines(taglist,pin_html);
    return `
<h6>${columnname}</h6>
<ul>
${html.slice(0,-1)}
</ul>
`;
}

//Event handlers

function ReloadFrequentTags(event) {
    Timer.QueryFrequentTags().then(()=>{
        Danbooru.Utility.notice(`${PROGRAM_NAME}: Frequent tags reloaded!`);
    });
    event.preventDefault();
}

function PinnedTagsToggle(event) {
    $(event.target).toggleClass("ui-icon-radio-off ui-icon-pin-s");
    let tag_name = $(".search-tag",event.target.parentElement).text().replace(/\s/g,'_');
    RTC.pinned_tags = JSPLib.utility.setSymmetricDifference(RTC.pinned_tags,[tag_name]);
    JSPLib.storage.setStorageData('rtc-pinned-tags',RTC.pinned_tags,localStorage);
    RTC.channel.postMessage({type: "reload_recent", recent_tags: RTC.recent_tags, pinned_tags: RTC.pinned_tags, other_recent: RTC.other_recent, updated_pin_tag: tag_name});
}

function CaptureTagSubmission(event) {
    RTC.postedittags = GetCurrentTags();
    RTC.new_recent_tags = NormalizeTags(RTC.postedittags);
    RTC.positivetags = JSPLib.utility.filterRegex(RTC.postedittags,negative_regex,true);
    RTC.negativetags = GetNegativetags(RTC.postedittags);
    RTC.userremovetags = JSPLib.utility.setDifference(RTC.preedittags,RTC.positivetags);
    RTC.removedtags = JSPLib.utility.setUnion(RTC.userremovetags,RTC.negativetags);
    RTC.unchangedtags = JSPLib.utility.setDifference(JSPLib.utility.setIntersection(RTC.preedittags,RTC.positivetags),RTC.negativetags);
    if (!RTC.user_settings.include_unchanged_tags) {
        RTC.new_recent_tags = JSPLib.utility.setDifference(RTC.new_recent_tags,RTC.unchangedtags);
    }
    if (!RTC.user_settings.include_removed_tags) {
        RTC.new_recent_tags = JSPLib.utility.setDifference(RTC.new_recent_tags,RTC.removedtags);
    } else {
        RTC.new_recent_tags = RTC.new_recent_tags.concat(RTC.userremovetags);
    }
    switch(RTC.tag_order) {
        case "alphabetic":
            RTC.new_recent_tags.sort();
            break;
        case "post_count":
        case "category":
            JSPLib.storage.setStorageData('rtc-new-recent-tags',RTC.new_recent_tags,localStorage);
            RTC.new_recent_tags = RTC.recent_tags;
            break;
        case "form_order":
        default:
            //Do nothing
    }
    CaptureTagSubmission.debuglog("New recent tags:",RTC.new_recent_tags);
    AddRecentTags(RTC.new_recent_tags);
}

//Main helper functions

async function CheckMissingTags(tag_list,list_name="") {
    CheckMissingTags.debuglog("Checking tag list:", tag_list);
    let network_tags = [];
    let [found_tags,missing_tags] = await JSPLib.storage.batchStorageCheck(tag_list,ValidateEntry,tag_expires,'tag');
    if (missing_tags.length) {
        CheckMissingTags.debuglog("Missing tags:",missing_tags);
        network_tags = await QueryMissingTags(missing_tags);
    } else {
        CheckMissingTags.debuglog(`No missing tags in DB [${list_name}]!`);
    }
    let unavailable_tags = JSPLib.utility.setDifference(found_tags, RTC.starting_tags);
    CheckMissingTags.debuglog("Unavailable tags:", unavailable_tags);
    if (network_tags.length || unavailable_tags.length) {
        let reload_tags = JSPLib.utility.setUnion(network_tags, unavailable_tags);
        reload_tags.forEach((tag)=>{
            let category = GetTagCategory(tag);
            $(`li.tag-type-${notfound_tag_category} a[href$="${tag}"]`).closest('li').removeClass().addClass(`tag-type-${category}`);
        });
    }
    return [unavailable_tags,missing_tags];
}

async function QueryMissingTags(missing_taglist) {
    let promise_array = [];
    let tag_query = missing_taglist.join(' ');
    let url_addons = {search: {name_space: tag_query, hide_empty: false}, only: tag_fields};
    let queried_tags = await JSPLib.danbooru.getAllItems('tags', max_item_limit, null, {addons: url_addons});
    queried_tags.forEach((tagentry)=>{
        let entryname = 'tag-' + tagentry.name;
        let value = {
            category: tagentry.category,
            postcount: tagentry.post_count,
            is_alias: tagentry.post_count === 0,
            is_deleted: false
        };
        RTC.tag_data[tagentry.name] = value;
        promise_array.push(JSPLib.storage.saveData(entryname, {value: value, expires: Date.now() + tag_expires}));
    });
    let network_tags = JSPLib.utility.getObjectAttributes(queried_tags, 'name');
    let unfound_tags = JSPLib.utility.setDifference(missing_taglist, network_tags);
    QueryMissingTags.debuglog("Network tags:", network_tags);
    QueryMissingTags.debuglog("Unfound tags:", unfound_tags);
    unfound_tags.forEach((tag)=>{
        let entryname = 'tag-' + tag;
        RTC.tag_data[tag] = deleted_tag_data;
        promise_array.push(JSPLib.storage.saveData(entryname, {value: deleted_tag_data, expires: Date.now() + tag_expires}));
    });
    await Promise.all(promise_array);
    RTC.channel.postMessage({type: "update_category", network_tags: network_tags});
    return network_tags;
}

/****FIX THIS FUNCTION!!!****/
async function CheckTagDeletion() {
    let promise_array = [];
    Object.keys(RTC.tag_data).forEach((tag)=>{
        if (RTC.tag_data[tag].is_alias) {
            let alias_entryname = 'ta-' + tag;
            let promise_entry = JSPLib.storage.checkLocalDB(alias_entryname,ValidateEntry,tagalias_expires)
            .then((data)=>{
                CheckTagDeletion.debuglog("Step 1: Check local DB for alias",data);
                if (data) {
                    return data;
                }
                return JSPLib.danbooru.submitRequest('tag_aliases', {search: {antecedent_name: tag, status: 'active'}, only: alias_fields}, [], false, alias_entryname)
                .then((data)=>{
                    CheckTagDeletion.debuglog("Step 2 (optional): Check server for alias",data);
                    let savedata = {value: [], expires: Date.now() + tagalias_expires};
                    if (data.length) {
                        //Alias antecedents are unique, so no need to check the size
                        CheckTagDeletion.debuglog("Alias:",tag,data[0].consequent_name);
                        savedata.value = [data[0].consequent_name];
                    }
                    CheckTagDeletion.debuglog("Saving",alias_entryname,savedata);
                    return JSPLib.storage.saveData(alias_entryname,savedata);
                });
            })
            .then((data)=>{
                let tag_entryname = 'tag-' + tag;
                CheckTagDeletion.debuglog("Step 3: Save tag data (if deleted)",data);
                if (data.value.length == 0) {
                    RTC.tag_data[tag].is_alias = false;
                    RTC.tag_data[tag].is_deleted = true;
                    let savedata = {value: RTC.tag_data[tag], expires: Date.now() + tag_expires};
                    CheckTagDeletion.debuglog("Saving",tag_entryname,savedata);
                    return JSPLib.storage.saveData(tag_entryname,savedata);
                }
            });
            promise_array.push(promise_entry);
        }
    });
}

function FilterDeletedTags() {
    JSPLib.debug.debugExecute(()=>{
        RTC.deleted_saved_recent_tags = RTC.saved_recent_tags.filter((tag)=>{return GetTagCategory(tag) === deleted_tag_category;});
        RTC.deleted_recent_tags = RTC.recent_tags.filter((tag)=>{return GetTagCategory(tag) === deleted_tag_category;});
        if (RTC.deleted_saved_recent_tags.length || RTC.deleted_recent_tags.length) {
            FilterDeletedTags.debuglog("Deleting tags:",RTC.deleted_saved_recent_tags,RTC.deleted_recent_tags);
        }
    });
    RTC.saved_recent_tags = RTC.saved_recent_tags.filter((tag)=>{return GetTagCategory(tag) !== deleted_tag_category;});
    RTC.recent_tags = RTC.recent_tags.filter((tag)=>{return GetTagCategory(tag) !== deleted_tag_category;});
}

function SortTagData(tag_list,type) {
    SortTagData.debuglog("Pre-sort:",tag_list);
    if (type === "post_count") {
        tag_list.sort((a,b)=>{
            let a_data = GetTagData(a);
            let b_data = GetTagData(b);
            return b_data.postcount - a_data.postcount;
        });
    } else if (type === "category") {
        let category_order = RTC.user_settings.category_order.concat(['deleted']);
        tag_list.sort((a,b)=>{
            let a_data = GetTagCategory(a);
            let b_data = GetTagCategory(b);
            return category_order.indexOf(category_name[a_data]) - category_order.indexOf(category_name[b_data]);
        });
    }
    SortTagData.debuglog("Post-sort:",tag_list);
}

//Main execution functions

////Recent tags

async function CheckAllRecentTags() {
    if (!JSPLib.concurrency.reserveSemaphore(PROGRAM_SHORTCUT, 'recent')) {
        RecheckDisplaySemaphore("recent");
        return;
    }
    let original_recent_tags = JSPLib.utility.dataCopy(RTC.recent_tags);
    RTC.saved_recent_tags = [];
    let tag_list = RTC.recent_tags.concat(RTC.pinned_tags);
    if (RTC.tag_order === "post_count" || RTC.tag_order === "category") {
        RTC.saved_recent_tags = JSPLib.storage.checkStorageData('rtc-new-recent-tags',ValidateProgramData,localStorage,[]);
        tag_list = JSPLib.utility.setUnion(tag_list,RTC.saved_recent_tags);
    }
    if (RTC.user_settings.list_type[0] === "multiple") {
        RTC.other_recent.forEach((recent_entry)=>{
            tag_list = JSPLib.utility.setUnion(tag_list,recent_entry.tags);
        });
    }
    RTC.missing_recent_tags = await Timer.CheckMissingTags(FilterMetatags(tag_list),"Recent");
    //await Timer.CheckTagDeletion();
    if (!RTC.user_settings.include_deleted_tags) {
        FilterDeletedTags();
    }
    if ((RTC.tag_order === "post_count" || RTC.tag_order === "category") && RTC.saved_recent_tags.length) {
        SortTagData(RTC.saved_recent_tags,RTC.tag_order);
    }
    localStorage.removeItem('rtc-new-recent-tags');
    if (JSPLib.utility.setSymmetricDifference(original_recent_tags,RTC.recent_tags).length || RTC.saved_recent_tags.length) {
        AddRecentTags(RTC.saved_recent_tags);
    }
    JSPLib.concurrency.freeSemaphore(PROGRAM_SHORTCUT, 'recent');
}

function AddRecentTags(newtags) {
    switch (RTC.user_settings.list_type[0]) {
        case "multiple":
            RTC.was_upload = JSPLib.storage.checkStorageData('rtc-was-upload',ValidateProgramData,localStorage,false);
            if (newtags.length && RTC.recent_tags.length) {
                RTC.other_recent.unshift({
                    was_upload: RTC.was_upload,
                    tags: RTC.recent_tags
                });
                RTC.other_recent = RTC.other_recent.slice(0,RTC.user_settings.maximum_tag_groups);
                JSPLib.storage.setStorageData('rtc-other-recent',RTC.other_recent,localStorage);
            }
            JSPLib.storage.setStorageData('rtc-was-upload',RTC.is_upload,localStorage);
            //falls through
        case "single":
            if (newtags.length) {
                RTC.recent_tags = newtags;
            }
            break;
        case "queue":
        default:
            RTC.recent_tags = JSPLib.utility.setUnion(newtags,RTC.recent_tags);
    }
    RTC.recent_tags = RTC.recent_tags.slice(0,RTC.user_settings.maximum_tags);
    JSPLib.storage.setStorageData('rtc-recent-tags',RTC.recent_tags,localStorage);
    RTC.channel.postMessage({type: "reload_recent", recent_tags: RTC.recent_tags, pinned_tags: RTC.pinned_tags, other_recent: RTC.other_recent, new_recent_tags: newtags});
}

////Frequent tags

async function LoadFrequentTags() {
    if (!RTC.userid) {
        //User must have an account to have frequent tags
        return;
    }
    RTC.frequent_tags = JSPLib.storage.checkStorageData('rtc-frequent-tags',ValidateProgramData,localStorage,[]);
    if (JSPLib.concurrency.checkTimeout('rtc-frequent-tags-expires',frequent_tags_expires)) {
        if (JSPLib.concurrency.reserveSemaphore(PROGRAM_SHORTCUT, 'frequent')) {
            await Timer.QueryFrequentTags();
            JSPLib.concurrency.freeSemaphore(PROGRAM_SHORTCUT, 'frequent')
        } else {
            return false;
        }
    }
    return true;
}

async function QueryFrequentTags() {
    let user_account = await JSPLib.danbooru.submitRequest('users',{search: {id: RTC.userid}, only: user_fields});
    if (!user_account || user_account.length === 0) {
        //Should never get here, but just in case
        return;
    }
    RTC.frequent_tags = user_account[0].favorite_tags.split('\r\n').map((tag)=>{return tag.trim();});
    QueryFrequentTags.debuglog("Found tags:",RTC.frequent_tags);
    JSPLib.storage.setStorageData('rtc-frequent-tags',RTC.frequent_tags,localStorage);
    JSPLib.concurrency.setRecheckTimeout('rtc-frequent-tags-expires',frequent_tags_expires);
    RTC.channel.postMessage({type: "reload_frequent", frequent_tags: RTC.frequent_tags});
}

async function CheckAllFrequentTags() {
    let status = await LoadFrequentTags();
    if (!status) {
        return;
    }
    if (JSPLib.concurrency.reserveSemaphore(PROGRAM_SHORTCUT, 'frequent')) {
        RTC.missing_frequent_tags = await Timer.CheckMissingTags(RTC.frequent_tags,"Frequent");
        JSPLib.concurrency.freeSemaphore(PROGRAM_SHORTCUT, 'frequent');
    } else {
        RecheckDisplaySemaphore("frequent");
    }
}

//Settings functions

function BroadcastRTC(ev) {
    BroadcastRTC.debuglog(`(${ev.data.type}):`, ev.data);
    switch (ev.data.type) {
        case "update_category":
            JSPLib.storage.batchStorageCheck(ev.data.network_tags, ValidateEntry, tag_expires, 'tag').then(()=>{
                ev.data.network_tags.forEach((tag)=>{
                    let category = GetTagCategory(tag);
                    $(`li.tag-type-${notfound_tag_category} a[href$="${tag}"]`).closest('li').removeClass().addClass(`tag-type-${category}`);
                });
            });
            break;
        case "reload_recent":
            RTC.pinned_tags = ev.data.pinned_tags;
            RTC.recent_tags = ev.data.recent_tags;
            RTC.other_recent = ev.data.other_recent;
            !RTC.is_setting_menu && RecheckAndDisplay("recent");
            break;
        case "reload_frequent":
            RTC.frequent_tags = ev.data.frequent_tags;
            !RTC.is_setting_menu && RecheckAndDisplay("frequent");
            //falls through
        default:
            //do nothing
    }
}

function RemoteSettingsCallback() {
    RTC.tag_order = GetTagOrderType();
}

function GetTagOrderType() {
    if (RTC.is_upload) {
        return RTC.user_settings.uploads_order[0];
    } else {
        return RTC.user_settings.post_edits_order[0];
    }
}

function RenderSettingsMenu() {
    $("#recent-tags-calc").append(rtc_menu);
    $("#rtc-general-settings").append(JSPLib.menu.renderDomainSelectors());
    $("#rtc-order-settings").append(JSPLib.menu.renderInputSelectors('uploads_order','radio'));
    $("#rtc-order-settings").append(JSPLib.menu.renderInputSelectors('post_edits_order','radio'));
    $("#rtc-order-settings").append(JSPLib.menu.renderCheckbox('metatags_first'));
    $("#rtc-order-settings").append(JSPLib.menu.renderCheckbox('aliases_first'));
    $("#rtc-order-settings").append(JSPLib.menu.renderSortlist('category_order'));
    $("#rtc-list-settings").append(JSPLib.menu.renderInputSelectors('list_type','radio'));
    $("#rtc-list-settings").append(JSPLib.menu.renderTextinput('maximum_tags',5));
    $("#rtc-list-settings").append(JSPLib.menu.renderTextinput('maximum_tag_groups',5));
    $("#rtc-inclusion-settings").append(JSPLib.menu.renderCheckbox('include_metatags'));
    $("#rtc-inclusion-settings").append(JSPLib.menu.renderCheckbox('include_unchanged_tags'));
    $("#rtc-inclusion-settings").append(JSPLib.menu.renderCheckbox('include_removed_tags'));
    $("#rtc-inclusion-settings").append(JSPLib.menu.renderCheckbox('include_deleted_tags'));
    $("#rtc-frequent-settings").append(JSPLib.menu.renderCheckbox('cache_frequent_tags'));
    $("#rtc-frequent-settings").append(JSPLib.menu.renderLinkclick('refresh_frequent_tags', true));
    $("#rtc-cache-settings").append(JSPLib.menu.renderLinkclick('cache_info', true));
    $("#rtc-cache-settings").append(CACHE_INFO_TABLE);
    $("#rtc-cache-settings").append(JSPLib.menu.renderLinkclick('purge_cache', true));
    $("#rtc-cache-editor-controls").append(JSPLib.menu.renderKeyselect('data_source', true));
    $("#rtc-cache-editor-controls").append(JSPLib.menu.renderDataSourceSections());
    $("#rtc-section-indexed-db").append(JSPLib.menu.renderKeyselect('data_type', true));
    $("#rtc-section-local-storage").append(JSPLib.menu.renderCheckbox('raw_data', true));
    $("#rtc-cache-editor-controls").append(JSPLib.menu.renderTextinput('data_name', 20, true));
    JSPLib.menu.engageUI(true,true);
    disabled_order_types.forEach((type)=>{
        $(`#rtc-select-uploads-order-${type}`).checkboxradio("disable");
        $(`#rtc-select-post-edits-order-${type}`).checkboxradio("disable");
    });
    $("#rtc-control-refresh-frequent-tags").on(PROGRAM_CLICK, ReloadFrequentTags);
    JSPLib.menu.saveUserSettingsClick();
    JSPLib.menu.resetUserSettingsClick(localstorage_keys);
    JSPLib.menu.cacheInfoClick();
    JSPLib.menu.purgeCacheClick();
    JSPLib.menu.dataSourceChange();
    JSPLib.menu.rawDataChange();
    JSPLib.menu.getCacheClick();
    JSPLib.menu.saveCacheClick(ValidateProgramData, ValidateEntry);
    JSPLib.menu.deleteCacheClick();
    JSPLib.menu.cacheAutocomplete();
}

//Main program

function Main() {
    Danbooru.RTC = RTC = {
        controller: document.body.dataset.controller,
        action: document.body.dataset.action,
        userid: Danbooru.CurrentUser.data('id'),
        is_setting_menu: JSPLib.danbooru.isSettingMenu(),
        settings_config: SETTINGS_CONFIG,
        control_config: CONTROL_CONFIG,
        channel: JSPLib.utility.createBroadcastChannel(PROGRAM_NAME, BroadcastRTC),
    };
    Object.assign(RTC, {
        is_upload: RTC.controller === 'uploads' && RTC.action === 'new',
        user_settings: JSPLib.menu.loadUserSettings(),
    }, PROGRAM_RESET_KEYS);
    if (RTC.is_setting_menu) {
        JSPLib.menu.loadStorageKeys();
        JSPLib.utility.installScript(JQUERY_TAB_WIDGET_URL).done(()=>{
            JSPLib.menu.installSettingsMenu();
            Timer.RenderSettingsMenu();
        });
        JSPLib.utility.setCSSStyle(MENU_CSS,'menu');
        return;
    }
    if (!JSPLib.menu.isScriptEnabled()) {
        Main.debuglog("Script is disabled on", window.location.hostname);
        return;
    }
    ListTypeCheck();
    Object.assign(RTC, {
        tag_order: GetTagOrderType(),
        preedittags: GetTagList(),
        starting_tags: GetStartingTags(),
        recent_tags: JSPLib.storage.checkStorageData('rtc-recent-tags', ValidateProgramData,localStorage, []),
        pinned_tags: JSPLib.storage.checkStorageData('rtc-pinned-tags', ValidateProgramData,localStorage, []),
    });
    Object.assign(RTC, {
        pageload_recentcheck: Timer.CheckAllRecentTags(),
        pageload_frequentcheck: Timer.CheckAllFrequentTags(),
    });
    $("#form").on('submit.rtc',Timer.CaptureTagSubmission);
    if (RTC.user_settings.cache_frequent_tags) {
        if (RTC.controller === 'posts' && RTC.action === 'show') {
            Danbooru.RTC.cached_data = true;
            $(document).off("danbooru:show-related-tags");
            if (!Danbooru.IAC || !Danbooru.IAC.cached_data) {
                $(document).one("danbooru:show-related-tags", Danbooru.Upload.fetch_data_manual);
            } else {
                $(document).one("danbooru:show-related-tags", Danbooru.IAC.FindArtistSession);
            }
        }
        $(".user-related-tags-columns")
            .addClass("rtc-user-related-tags-columns")
            .removeClass("user-related-tags-columns")
            .html(usertag_columns_html);
        DisplayRecentTags();
        DisplayFrequentTags();
    } else if ($(".recent-related-tags-column").length) {
        DisplayRecentTags();
    } else {
        JSPLib.utility.setupMutationReplaceObserver(".related-tags",".user-related-tags-columns",()=>{
            Main.debuglog("Server: User related tags have been added!");
            DisplayRecentTags();
        });
    }
    JSPLib.utility.setCSSStyle(program_css,'program');
    JSPLib.statistics.addPageStatistics(PROGRAM_NAME);
    setTimeout(()=>{
        JSPLib.storage.pruneEntries(PROGRAM_SHORTCUT, PROGRAM_DATA_REGEX, prune_expires);
    }, noncritical_recheck);
}

/****Function decoration****/

JSPLib.debug.addFunctionTimers(Timer,false,[
    RenderSettingsMenu,CaptureTagSubmission
]);

JSPLib.debug.addFunctionTimers(Timer,true,[
    CheckAllRecentTags,CheckAllFrequentTags,QueryFrequentTags,
    [CheckMissingTags, 1],
    //CheckTagDeletion
]);

JSPLib.debug.addFunctionLogs([
    Main,BroadcastRTC,QueryFrequentTags,CaptureTagSubmission,SortTagData,FilterDeletedTags,//CheckTagDeletion,
    QueryMissingTags,CheckMissingTags,RecheckDisplaySemaphore,ValidateEntry
]);

/****Initialization****/

//Variables for debug.js
JSPLib.debug.debug_console = false;
JSPLib.debug.pretext = "RTC:";
JSPLib.debug.pretimer = "RTC-";
JSPLib.debug.level = JSPLib.debug.INFO;

//Variables for menu.js
JSPLib.menu.program_shortcut = PROGRAM_SHORTCUT;
JSPLib.menu.program_name = PROGRAM_NAME;
JSPLib.menu.program_reset_data = PROGRAM_RESET_KEYS;
JSPLib.menu.program_data_regex = PROGRAM_DATA_REGEX;
JSPLib.menu.program_data_key = PROGRAM_DATA_KEY;
JSPLib.menu.settings_callback = RemoteSettingsCallback;
JSPLib.menu.reset_callback = RemoteSettingsCallback;

//Export JSPLib
if (JSPLib.debug.debug_console) {
    window.JSPLib.lib = window.JSPLib.lib || {};
    window.JSPLib.lib[PROGRAM_NAME] = JSPLib;
}

/****Execution start****/

JSPLib.load.programInitialize(Main,'RTC',program_load_required_variables,program_load_required_selectors);
