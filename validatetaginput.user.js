// ==UserScript==
// @name         ValidateTagInput
// @namespace    https://github.com/BrokenEagle/JavaScripts
// @version      26.0
// @source       https://danbooru.donmai.us/users/23799
// @description  Validates tag add/remove inputs on a post edit or upload.
// @author       BrokenEagle
// @match        *://*.donmai.us/posts*
// @match        *://*.donmai.us/uploads*
// @match        *://*.donmai.us/users/*/edit
// @grant        none
// @run-at       document-end
// @downloadURL  https://raw.githubusercontent.com/BrokenEagle/JavaScripts/stable/validatetaginput.user.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/localforage/1.5.2/localforage.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/validate.js/0.12.0/validate.min.js
// @require      https://raw.githubusercontent.com/BrokenEagle/JavaScripts/20181230/lib/debug.js
// @require      https://raw.githubusercontent.com/BrokenEagle/JavaScripts/20181230/lib/load.js
// @require      https://raw.githubusercontent.com/BrokenEagle/JavaScripts/20181230/lib/storage.js
// @require      https://raw.githubusercontent.com/BrokenEagle/JavaScripts/20181230/lib/validate.js
// @require      https://raw.githubusercontent.com/BrokenEagle/JavaScripts/20181230/lib/utility.js
// @require      https://raw.githubusercontent.com/BrokenEagle/JavaScripts/20181230/lib/statistics.js
// @require      https://raw.githubusercontent.com/BrokenEagle/JavaScripts/20181230/lib/danbooru.js
// @require      https://raw.githubusercontent.com/BrokenEagle/JavaScripts/20181230/lib/menu.js
// ==/UserScript==

/***Global variables***/

//Variables for debug.js
JSPLib.debug.debug_console = false;
JSPLib.debug.pretext = "VTI:";
JSPLib.debug.pretimer = "VTI-";
JSPLib.debug.level = JSPLib.debug.INFO;

//Variables for load.js
const program_load_required_variables = ['window.jQuery','window.Danbooru'];
const program_load_required_selectors = ['#page'];

//Regex that matches the prefix of all program cache data
const program_cache_regex = /^(?:ti|ta)-/;

//Main program expires
const prune_expires = JSPLib.utility.one_day;

//For factory reset
const localstorage_keys = [];
const program_reset_keys = {};

//Main settings
const settings_config = {
    alias_check_enabled: {
        default: true,
        validate: (data)=>{return validate.isBoolean(data);},
        hint: "Uncheck to turn off."
    },
    implication_check_enabled: {
        default: true,
        validate: (data)=>{return validate.isBoolean(data);},
        hint: "Uncheck to turn off."
    },
    upload_check_enabled: {
        default: false,
        validate: (data)=>{return validate.isBoolean(data);},
        hint: "Check to turn on."
    },
    artist_check_enabled: {
        default: true,
        validate: (data)=>{return validate.isBoolean(data);},
        hint: "Check to turn off."
    },
    copyright_check_enabled: {
        default: true,
        validate: (data)=>{return validate.isBoolean(data);},
        hint: "Check to turn off."
    },
    general_check_enabled: {
        default: true,
        validate: (data)=>{return validate.isBoolean(data);},
        hint: "Check to turn off."
    },
    general_minimum_threshold: {
        default: 10,
        parse: parseInt,
        validate: (data)=>{return Number.isInteger(data) && data > 0;},
        hint: "The bare minimum number of general tags."
    },
    general_low_threshold: {
        default: 25,
        parse: parseInt,
        validate: (data)=>{return Number.isInteger(data) && data >= 0;},
        hint: "Threshold for a low amount of general tags. Enter 0 to disable this threshold."
    },
    general_moderate_threshold: {
        default: 35,
        parse: parseInt,
        validate: (data)=>{return Number.isInteger(data) && data >= 0;},
        hint: "Threshold for a moderate amount of general tags. Enter 0 to disable this threshold."
    },
    single_session_warning: {
        default: true,
        validate: (data)=>{return validate.isBoolean(data);},
        hint: "Pre-edit warnings will only appear once per post per tab session."
    }
}

//HTML constants

const submit_button = `
<input id="validate-tags" type="button" class="ui-button ui-widget ui-corner-all" value="Submit">
<input id="check-tags" type="button" class="ui-button ui-widget ui-corner-all" value="Check">`;

const input_validator = `
<div id="validation-input" style="display:none">
<label for="skip-validate-tags">Skip Validation</label>
<input type="checkbox" id="skip-validate-tags">
</div>`;

const reset_storage = `
<div class="input">
    <label>Site data</label>
    <p><a href="#" id="reset-storage-link">Reset cached data</a></p>
</div>`;

const warning_messages = `
<div id="warning-bad-upload" class="error-messages ui-state-error ui-corner-all" style="display:none"></div>
<div id="warning-new-tags" class="error-messages ui-state-error ui-corner-all" style="display:none"></div>
<div id="warning-bad-removes" class="error-messages ui-state-highlight ui-corner-all" style="display:none"></div>`;

const vti_menu = `
<div id="vti-settings" class="jsplib-outer-menu">
    <div id="vti-script-message" class="prose">
        <h2>ValidateTagInput</h2>
        <p>Check the forum for the latest on information and updates (<a class="dtext-link dtext-id-link dtext-forum-topic-id-link" href="/forum_topics/14474" style="color:#0073ff">topic #14474</a>).</p>
    </div>
    <div id="vti-pre-edit-settings" class="jsplib-settings-grouping">
        <div id="vti-pre-edit-message" class="prose">
            <h4>Pre edit settings</h4>
            <p>These settings affect validations when a post page is initially loaded.</p>
            <ul>
                <li><b>Artist check enabled:</b> Does a check for any artist tags or artist entries.
                    <ul>
                        <li>Posts with <a href="/wiki_pages/show_or_new?title=artist_request" style="color:#0073ff">artist request</a> or <a href="/wiki_pages/show_or_new?title=official_art" style="color:#0073ff">official art</a> are ignored.</li>
                        <li>Artist tags on posts get checked for artist entries.</li>
                    </ul>
                </li>
                <li><b>Copyright check enabled:</b> Checks for the existence of any copyright tag or the <a href="/wiki_pages/show_or_new?title=copyright_request" style="color:#0073ff">copyright request</a> tag.</li>
                <li><b>General check enabled:</b> Performs a general tag count with up to 3 warning thresholds.</li>
            </ul>
        </div>
    </div>
    <div id="vti-post-edit-settings" class="jsplib-settings-grouping">
        <div id="vti-post-edit-message" class="prose">
            <h4>Post edit settings</h4>
            <p>These settings affect validations when submitting a post edit.</p>
            <ul>
                <li><b>Alias check enabled:</b> Checks and removes aliased tags from tag add validation.
                    <ul>
                        <li>Turning off no longer queries all tag adds for aliases.</li>
                    </ul>
                </li>
                <li><b>Implications check enabled:</b> Used as the primary source for tag remove validation.
                    <ul>
                        <li>Turning off no longer queries all tags on page load for implications.</li>
                        <li><b>Note:</b> This effectively turns off tag remove validation.</li>
                    </ul>
                </li>
                <li><b>Upload check enabled:</b> Performs the same rating and source checks that Danbooru does.
                    <ul>
                        <li>The main benefit is it moves the warning message closer to the submit button.</li>
                        <li>I.e in the same location as the other <i>ValidateTagInput</i> warning messages.</li>
                    </ul>
                </li>
            </ul>
        </div>
    </div>
    <div id="vti-cache-settings" class="jsplib-settings-grouping">
        <div id="vti-cache-message" class="prose">
            <h4>Cache settings</h4>
            <h5>Cache data</h5>
            <ul>
                <li><b>Tag aliases:</b> Used to determine which removes are bad.</li>
                <li><b>Tag implications:</b> Used to determine if a tag is bad or an alias.</li>
            </ul>
            <h5>Cache controls</h5>
            <ul>
                <li><b>Purge cache:</b> Dumps all of the cached data related to ValidateTagInput.</li>
            </ul>
        </div>
    </div>
    <hr>
    <div id="vti-settings-buttons" class="jsplib-settings-buttons">
        <input type="button" id="vti-commit" value="Save">
        <input type="button" id="vti-resetall" value="Factory Reset">
    </div>
</div>`;

//Wait time for quick edit box
// 1. Let box close before reenabling the submit button
// 2. Let box open before querying the implications
const quickedit_wait_time = 1000;

//Polling interval for checking program status
const timer_poll_interval = 100;

//Expiration time is one month
const validatetag_expiration_time = JSPLib.utility.one_month;

//Tag regexes
const metatags_regex = /^(?:rating|-?parent|source|-?locked|-?pool|newpool|-?fav|child|-?favgroup|upvote|downvote):/i;
const typetags_regex = /^-?(?:general|gen|artist|art|copyright|copy|co|character|char|ch|meta):/i;
const negative_regex = /^-/;
const striptype_regex = /^(-?)(?:general:|gen:|artist:|art:|copyright:|copy:|co:|character:|char:|ch:|meta:)?(.*)/i

//Validate constants

const relation_constraints = {
    entry: JSPLib.validate.arrayentry_constraints,
    value: JSPLib.validate.stringonly_constraints
};

/***Functions***/

//Validate functions

function ValidateRelationEntry(key,entry) {
    if (!JSPLib.validate.validateIsHash(key,entry)) {
        return false
    }
    let check = validate(entry,relation_constraints.entry);
    if (check !== undefined) {
        JSPLib.validate.printValidateError(key,check);
        return false
    }
    return JSPLib.validate.validateArrayValues(key + '.value', entry.value, relation_constraints.value);
}

//Library functions

//// NONE

//Helper functions

function GetTagList() {
    return JSPLib.utility.filterEmpty(StripQuoteSourceMetatag($("#upload_tag_string,#post_tag_string").val()).split(/[\s\n]+/).map(tag=>{return tag.toLowerCase();}));
}

function StripQuoteSourceMetatag(str) {
    return str.replace(/source:"[^"]+"\s?/g,'');
}

function GetNegativetags(array) {
    return JSPLib.utility.filterRegex(array,negative_regex,false).map((value)=>{return value.substring(1);});
}

function TransformTypetags(array) {
    return array.map((value)=>{return value.match(striptype_regex).splice(1).join('');});
}

function GetCurrentTags() {
    return JSPLib.utility.filterRegex(JSPLib.utility.filterRegex(GetTagList(),metatags_regex,true),typetags_regex,true);
}

function GetAllRelations(tag,implicationdict) {
    var tmp = [];
    if (tag in implicationdict) {
        for(let i=0;i<implicationdict[tag].length;i++) {
            tmp.push(implicationdict[tag][i]);
            let tmp2 = GetAllRelations(implicationdict[tag][i],implicationdict);
            tmp = tmp.concat(tmp2);
        }
        return tmp;
    } else {
        return [];
    }
}

function IsSkipValidate() {
    return $("#skip-validate-tags")[0].checked;
}

function DisableUI(type) {
    $("#validate-tags")[0].setAttribute('disabled','true');
    $("#check-tags")[0].setAttribute('disabled','true');
    if (type === "submit") {
        $("#validate-tags")[0].setAttribute('value','Submitting...');
    } else if (type === "check") {
        $("#check-tags")[0].setAttribute('value','Checking...');
    }
}

function EnableUI(type) {
    $("#validate-tags")[0].removeAttribute('disabled');
    $("#check-tags")[0].removeAttribute('disabled');
    if (type === "submit") {
        $("#validate-tags")[0].setAttribute('value','Submit');
    } else if (type === "check") {
        $("#check-tags")[0].setAttribute('value','Check');
    }
}

//Network functions

async function QueryTagAlias(tag) {
    let consequent = "";
    let entryname = 'ta-'+tag;
    let storeditem = await JSPLib.storage.checkLocalDB(entryname,ValidateRelationEntry,validatetag_expiration_time);
    if (!storeditem) {
        JSPLib.debug.debuglog("Querying alias:",tag);
        let data = await JSPLib.danbooru.submitRequest('tag_aliases',{search:{antecedent_name:tag,status:'active'}},[],entryname);
        if (data.length) {
            //Alias antecedents are unique, so no need to check the size
            JSPLib.debug.debuglog("Alias:",tag,data[0].consequent_name);
            Danbooru.VTI.aliastags.push(tag);
            consequent = [data[0].consequent_name];
        } else {
            consequent = [];
        }
        JSPLib.storage.saveData(entryname, {value: consequent, expires: Date.now() + validatetag_expiration_time});
    } else {
        consequent = storeditem.value;
        if (consequent.length) {
            JSPLib.debug.debuglog("Alias:",tag,consequent[0]);
            Danbooru.VTI.aliastags.push(tag);
        }
    }
}

//Queries aliases of added tags... can be called multiple times
const QueryTagAliases = JSPLib.debug.debugAsyncTimer(async (taglist)=>{
    for (let i = 0;i < taglist.length;i++) {
        if (Danbooru.VTI.seenlist.includes(taglist[i])) {
            continue;
        }
        Danbooru.VTI.seenlist.push(taglist[i]);
        Danbooru.VTI.aliases_promise_array.push(QueryTagAlias(taglist[i]));
    }
    await Promise.all(Danbooru.VTI.aliases_promise_array);
    JSPLib.debug.debuglog("Aliases:",Danbooru.VTI.aliastags);
},"QueryTagAliases");

async function QueryTagImplication(tag) {
    let entryname = 'ti-'+tag;
    let storeditem = await JSPLib.storage.checkLocalDB(entryname,ValidateRelationEntry,validatetag_expiration_time);
    if (!storeditem) {
        JSPLib.debug.debuglog("Querying implication:",tag);
        let data = await JSPLib.danbooru.submitRequest('tag_implications',{limit:100,search:{consequent_name:tag,status:'active'}},[],entryname);
        let implications = data.map(entry=>{return entry.antecedent_name;});
        Danbooru.VTI.implicationdict[tag] = implications;
        JSPLib.storage.saveData(entryname, {value: implications, expires: Date.now() + validatetag_expiration_time});
    } else {
        Danbooru.VTI.implicationdict[tag] = storeditem.value;
    }
}

//Queries implications of preexisting tags... called once per image
const QueryTagImplications = JSPLib.debug.debugAsyncTimer(async (taglist)=>{
    for (let i = 0;i < taglist.length;i++) {
        Danbooru.VTI.implications_promise_array.push(QueryTagImplication(taglist[i]));
    }
    await Promise.all(Danbooru.VTI.implications_promise_array);
    JSPLib.debug.debuglog("Implications:",Danbooru.VTI.implicationdict);
},"QueryTagImplications");

//Click functions

function PostModeMenuClick(e) {
    let s = $("#mode-box select").val();
    if (s === "edit") {
        $("#validation-input,#warning-bad-upload,#warning-new-tags,#warning-bad-removes").hide();
        let post_id = $(e.target).closest("article").data("id");
        let $post = $("#post_" + post_id);
        Danbooru.VTI.preedittags = $post.data("tags").split(' ');
        JSPLib.debug.debuglog("Preedit tags:",Danbooru.VTI.preedittags);
        //Wait until the edit box loads before querying implications
        if (Danbooru.VTI.user_settings.implication_check_enabled) {
            setTimeout(()=>{QueryTagImplications(Danbooru.VTI.preedittags);},quickedit_wait_time);
        }
        e.preventDefault();
    }
}

async function CheckTagsClick(e) {
    //Prevent code from being reentrant until finished processing
        JSPLib.debug.debugTime("CheckTagsClick");
        DisableUI("check");
        let statuses = (await Promise.all([ValidateTagAdds(),ValidateTagRemoves(),ValidateUpload()]));
        if (statuses.every((item)=>{return item;})) {
            Danbooru.Utility.notice("Tags good to submit!");
        } else {
            Danbooru.Utility.error("Tag validation failed!");
        }
        EnableUI("check");
        JSPLib.debug.debugTimeEnd("CheckTagsClick");
}

async function ValidateTagsClick(e) {
    //Prevent code from being reentrant until finished processing
    if (ValidateTagsClick.isready) {
        ValidateTagsClick.isready = false;
        JSPLib.debug.debugTime("ValidateTagsClick");
        DisableUI("submit");
        let statuses = await Promise.all([ValidateTagAdds(),ValidateTagRemoves(),ValidateUpload()]);
        if (statuses.every((item)=>{return item;})) {
            JSPLib.debug.debuglog("Submit request!");
            $("#form,#quick-edit-form").trigger("submit");
            if ($("#c-uploads #a-new,#c-posts #a-show").length) {
                JSPLib.debug.debuglog("Disabling return key!");
                $("#upload_tag_string,#post_tag_string").off("keydown.danbooru.submit");
            }
            if (Danbooru.VTI.is_upload) {
                //Check for the triggering of Danbooru's client validation (file/source/rating)
                ReenableSubmitCallback.timer = setInterval(ReenableSubmitCallback,timer_poll_interval);
            } else if ($("#c-posts #a-index").length) {
                //Wait until the edit box closes to reenable the submit button click
                setTimeout(()=>{
                    JSPLib.debug.debuglog("Ready for next edit!");
                    EnableUI("submit");
                    $("#skip-validate-tags")[0].checked = false;
                    ValidateTagsClick.isready = true;
                },quickedit_wait_time);
            }
        } else {
            JSPLib.debug.debuglog("Validation failed!");
            EnableUI("submit");
            ValidateTagsClick.isready = true;
        }
        JSPLib.debug.debugTimeEnd("ValidateTagsClick");
    }
}
ValidateTagsClick.isready = true;

//Timer/callback functions

function ReenableSubmitCallback() {
    if ($("#client-errors").css("display") !== "none") {
        clearInterval(ReenableSubmitCallback.timer);
        JSPLib.debug.debuglog("Danbooru's client validation failed!");
        EnableUI("submit");
        $("#upload_tag_string").on("keydown.danbooru.submit", null, "return", (e)=>{
            $("#validate-tags").click();
            e.preventDefault();
        });
        ValidateTagsClick.isready = true;
    }
}

function RebindHotkey() {
    if (JSPLib.utility.isNamespaceBound("#upload_tag_string,#post_tag_string",'keydown','danbooru.submit')) {
        clearInterval(RebindHotkey.timer);
        $("#upload_tag_string,#post_tag_string").off("keydown.danbooru.submit").on("keydown.danbooru.submit", null, "return", (e)=>{
            $("#validate-tags").click();
            e.preventDefault();
        });
    }
}

//Main execution functions

const ValidateTagAdds = JSPLib.debug.debugAsyncTimer(async ()=>{
    let postedittags = GetCurrentTags();
    let positivetags = JSPLib.utility.filterRegex(postedittags,negative_regex,true);
    let useraddtags = JSPLib.utility.setDifference(positivetags,Danbooru.VTI.preedittags);
    Danbooru.VTI.addedtags = JSPLib.utility.setDifference(useraddtags,GetNegativetags(postedittags));
    JSPLib.debug.debuglog("Added tags:",Danbooru.VTI.addedtags);
    if ((Danbooru.VTI.addedtags.length === 0) || IsSkipValidate()) {
        JSPLib.debug.debuglog("Tag Add Validation - Skipping!");
        $("#warning-new-tags").hide();
        return true;
    }
    let alltags = await JSPLib.danbooru.getAllItems('tags',100,{addons:{search:{name:Danbooru.VTI.addedtags.join(','),hide_empty:'yes'}}});
    Danbooru.VTI.checktags = alltags.map(entry=>{return entry.name;});
    let nonexisttags = JSPLib.utility.setDifference(Danbooru.VTI.addedtags,Danbooru.VTI.checktags);
    if (Danbooru.VTI.user_settings.alias_check_enabled) {
        await QueryTagAliases(Danbooru.VTI.addedtags);
        nonexisttags = JSPLib.utility.setDifference(nonexisttags,Danbooru.VTI.aliastags);
    }
    if (nonexisttags.length > 0) {
        JSPLib.debug.debuglog("Tag Add Validation - Nonexistant tags!");
        $.each(nonexisttags,(i,tag)=>{JSPLib.debug.debuglog(i,tag);});
        $("#validation-input").show();
        $("#warning-new-tags").show();
        let taglist = nonexisttags.join(', ');
        $("#warning-new-tags")[0].innerHTML = '<strong>Warning</strong>: The following new tags will be created:  ' + taglist;
        return false;
    }
    JSPLib.debug.debuglog("Tag Add Validation - Free and clear to submit!");
    $("#warning-new-tags").hide();
    return true;
},"ValidateTagAdds");

const ValidateTagRemoves = JSPLib.debug.debugAsyncTimer(async ()=>{
    if (!Danbooru.VTI.user_settings.implication_check_enabled || IsSkipValidate()) {
        JSPLib.debug.debuglog("Tag Remove Validation - Skipping!");
        $("#warning-bad-removes").hide();
        return true;
    }
    await Promise.all(Danbooru.VTI.implications_promise_array);
    let postedittags = TransformTypetags(GetCurrentTags());
    let deletedtags = JSPLib.utility.setDifference(Danbooru.VTI.preedittags,postedittags);
    let negatedtags = JSPLib.utility.setIntersection(GetNegativetags(postedittags),postedittags);
    let removedtags = deletedtags.concat(negatedtags);
    let finaltags = JSPLib.utility.setDifference(postedittags,removedtags);
    JSPLib.debug.debuglog("Final tags:",finaltags);
    JSPLib.debug.debuglog("Removed tags:",deletedtags,negatedtags);
    let allrelations = [];
    $.each(removedtags,(i,tag)=>{
        let badremoves = JSPLib.utility.setIntersection(GetAllRelations(tag,Danbooru.VTI.implicationdict),finaltags);
        if (badremoves.length) {
            allrelations.push(badremoves.toString() + ' -> ' + tag);
        }
    });
    if (allrelations.length) {
        JSPLib.debug.debugExecute(()=>{
            JSPLib.debug.debuglog("Tag Remove Validation - Badremove tags!");
            $.each(allrelations,(i,relation)=>{JSPLib.debug.debuglog(i,relation);});
        });
        $("#validation-input").show();
        $("#warning-bad-removes").show();
        let removelist = allrelations.join('<br>');
        $("#warning-bad-removes")[0].innerHTML = '<strong>Notice</strong>: The following implication relations prevent certain tag removes:<br>' + removelist;
        return false;
    }
    JSPLib.debug.debuglog("Tag Remove Validation - Free and clear to submit!");
    $("#warning-bad-removes").hide();
    return true;
},"ValidateTagRemoves");

function ValidateUpload() {
    if (!Danbooru.VTI.user_settings.upload_check_enabled || !Danbooru.VTI.is_upload || IsSkipValidate()) {
        JSPLib.debug.debuglog("Upload Validation - Skipping!");
        $("#warning-bad-upload").hide();
        return true;
    }
    let errormessages = [];
    let ratingtag = Boolean(JSPLib.utility.filterRegex(GetTagList(),/^rating:[sqe]/i).length);
    let ratingradio = $(".ratings input").toArray().some((input)=>{return input.checked;});
    if (!ratingtag && !ratingradio) {
        errormessages.push("Must specify a rating.");
    }
    if ($("#upload_file,#upload_source,#upload_md5_confirmation").toArray().every((input)=>{return $(input).val() === "";})) {
        errormessages.push("Must choose file or specify source.");
    }
    if (errormessages.length) {
        JSPLib.debug.debuglog("Upload Validation: " + errormessages.join(' '));
        $("#validation-input").show();
        $("#warning-bad-upload").show();
        $("#warning-bad-upload")[0].innerHTML = '<strong>Warning</strong>: ' + errormessages.join(' ');
        return false;
    }
    JSPLib.debug.debuglog("Upload Validation - Free and clear to submit!");
    $("#warning-bad-upload").hide();
    return true;
}

async function ValidateArtist() {
    let source_url = $("#post_source").val();
    let new_artist_source = $.param({artist: {source: source_url}});
    let artist_names = $(".artist-tag-list .category-1 .wiki-link").map((i,entry)=>{return decodeURI(entry.search.split("=")[1]);}).toArray();
    if (artist_names.length === 0) {
        //Validate no artist tag
        let option_html = "";
        if (!source_url.match(/https?:\/\//)) {
            JSPLib.debug.debuglog("ValidateArtist: Not a URL.");
            return;
        }
        let source_resp = await JSPLib.danbooru.submitRequest('source',{url: source_url},{artist: {name: null}});
        if (source_resp.artist.name === null) {
            JSPLib.debug.debuglog("ValidateArtist: Not a first-party source.");
            return;
        }
        if (source_resp.artists.length) {
            let artist_list = source_resp.artists.map((artist)=>{return `<a href="/artists/show_or_new?name=${artist.name}">${artist.name}</a>`;});
            let artist_html = `There is an available artist tag for this post [${artist_list.join(', ')}]. Open the edit menu and consider adding it.`;
            Danbooru.VTI.validate_lines.push(artist_html);
        } else {
            if (JSPLib.utility.setIntersection(Danbooru.VTI.preedittags,['artist_request','official_art']).length === 0) {
                option_html = `<br>...or, consider adding at least <a href="/wiki_pages/show_or_new?title=artist_request">artist request</a> or <a href="/wiki_pages/show_or_new?title=official_art">official art</a> as applicable.`;
            }
            let artist_html = `Artist tag is required. <a href="/artists/new?${new_artist_source}">Create new artist entry</a>. Ask on the forum if you need naming help.`;
            Danbooru.VTI.validate_lines = Danbooru.VTI.validate_lines.concat([artist_html + option_html]);
        }
    } else {
        //Validate artists have entry
        let promise_array = artist_names.map((name)=>{return JSPLib.danbooru.submitRequest('artists',{search: {name_like: name}});});
        let artists = (await Promise.all(promise_array)).flat();
        if (artists.includes(null)) {
            JSPLib.debug.debuglog("ValidateArtist: Bad HTTP request.");
            return;
        }
        let found_artists = JSPLib.utility.getObjectAttributes(artists,'name');
        let missing_artists = JSPLib.utility.setDifference(artist_names,found_artists);
        if (missing_artists.length === 0) {
            JSPLib.debug.debuglog("ValidateArtist: No missing artists.");
            return;
        }
        let artist_lines = artist_names.map((artist)=>{
            return  `
            Artist <a href="/artists/show_or_new?name=${artist}">${artist}</a> requires an artist entry.
            <a href="/artists/new?${new_artist_source}">Create new artist entry</a>`;
        });
        Danbooru.VTI.validate_lines = Danbooru.VTI.validate_lines.concat(artist_lines);
    }
    Danbooru.Utility.notice(Danbooru.VTI.validate_lines.join('<hr>'),true);
}

function ValidateCopyright() {
    let copyright_names_length = $(".copyright-tag-list .category-3 .wiki-link").length;
    if (copyright_names_length) {
        JSPLib.debug.debuglog("ValidateCopyright: Has a copyright.");
        return;
    } else if (Danbooru.VTI.preedittags.includes('copyright_request')) {
        JSPLib.debug.debuglog("ValidateCopyright: Has copyright request.");
        return;
    }
    let copyright_html = `Copyright tag is required. Consider adding <a href="/wiki_pages/show_or_new?title=copyright_request">copyright request</a> or <a href="/wiki_pages/show_or_new?title=original">original</a>.`
    Danbooru.VTI.validate_lines.push(copyright_html);
    Danbooru.Utility.notice(Danbooru.VTI.validate_lines.join('<br>'),true);
}

let how_to_tag = `Read <a href="/wiki_pages/show_or_new?title=howto%3atag">howto:tag</a> for guidelines on how to tag.`;

function ValidateGeneral() {
    let general_tags_length = $(".general-tag-list .category-0 .wiki-link").length;
    //Have 3 user settings for the following thresholds...maybe
    if (general_tags_length < Danbooru.VTI.user_settings.general_minimum_threshold) {
        Danbooru.VTI.validate_lines.push("Posts must have at least 10 general tags. Please add some more tags. " + how_to_tag);
    } else if (Danbooru.VTI.user_settings.general_low_threshold && general_tags_length < Danbooru.VTI.user_settings.general_low_threshold) {
        Danbooru.VTI.validate_lines.push("The post has a low amount of general tags. Consider adding more. " + how_to_tag);
    } else if (Danbooru.VTI.user_settings.general_moderate_threshold && general_tags_length < Danbooru.VTI.user_settings.general_moderate_threshold) {
        Danbooru.VTI.validate_lines.push("The post has a moderate amount of general tags, but could potentially need more. " + how_to_tag);
    } else {
        JSPLib.debug.debuglog("ValidateGeneral: Has enough tags.");
        return;
    }
    Danbooru.Utility.notice(Danbooru.VTI.validate_lines.join('<br>'),true);
}

//Settings functions

function BroadcastVTI(ev) {
    JSPLib.debug.debuglog(`BroadcastChannel (${ev.data.type}):`,ev.data);
    if (ev.data.type === "settings") {
        Danbooru.VTI.user_settings = ev.data.user_settings;
    } else if (ev.data.type === "reset") {
        Danbooru.VTI.user_settings = ev.data.user_settings;
        Object.assign(Danbooru.VTI,program_reset_keys);
    } else if (ev.data.type === "purge") {
        $.each(sessionStorage,(key)=>{
            if (key.match(program_cache_regex)) {
                sessionStorage.removeItem(key);
            }
        });
    }
}

function RenderSettingsMenu() {
    $("#validate-tag-input").append(vti_menu);
    $("#vti-pre-edit-settings").append(JSPLib.menu.renderCheckbox("vti",'single_session_warning'));
    $("#vti-pre-edit-settings").append(JSPLib.menu.renderCheckbox("vti",'artist_check_enabled'));
    $("#vti-pre-edit-settings").append(JSPLib.menu.renderCheckbox("vti",'copyright_check_enabled'));
    $("#vti-pre-edit-settings").append(JSPLib.menu.renderCheckbox("vti",'general_check_enabled'));
    $("#vti-pre-edit-settings").append(JSPLib.menu.renderTextinput("vti",'general_minimum_threshold',10));
    $("#vti-pre-edit-settings").append(JSPLib.menu.renderTextinput("vti",'general_low_threshold',10));
    $("#vti-pre-edit-settings").append(JSPLib.menu.renderTextinput("vti",'general_moderate_threshold',10));
    $("#vti-post-edit-settings").append(JSPLib.menu.renderCheckbox("vti",'alias_check_enabled'));
    $("#vti-post-edit-settings").append(JSPLib.menu.renderCheckbox("vti",'implication_check_enabled'));
    $("#vti-post-edit-settings").append(JSPLib.menu.renderCheckbox("vti",'upload_check_enabled'));
    $("#vti-cache-settings").append(JSPLib.menu.renderLinkclick("vti",'purge_cache',`Purge cache (<span id="vti-purge-counter">...</span>)`,"Click to purge"));
    JSPLib.menu.saveUserSettingsClick('vti','ValidateTagInput');
    JSPLib.menu.resetUserSettingsClick('vti','ValidateTagInput',localstorage_keys,program_reset_keys);
    JSPLib.menu.purgeCacheClick('vti','ValidateTagInput',program_cache_regex,"#vti-purge-counter");
}

//Main program

function main() {
    Danbooru.VTI = {
        channel: new BroadcastChannel('ValidateTagInput'),
        aliastags: [],
        seenlist: [],
        aliases_promise_array: [],
        implicationdict: {},
        implications_promise_array: [],
        is_upload: false,
        was_upload: JSPLib.storage.getStorageData('vti-was-upload',sessionStorage,false),
        validate_lines: [],
        settings_config: settings_config
    }
    Danbooru.VTI.user_settings = JSPLib.menu.loadUserSettings('vti');
    Danbooru.VTI.channel.onmessage = BroadcastVTI;
    if ($("#c-users #a-edit").length) {
        JSPLib.utility.installScript("https://cdn.jsdelivr.net/gh/jquery/jquery-ui@1.12.1/ui/widgets/tabs.js").done(()=>{
            JSPLib.menu.installSettingsMenu("ValidateTagInput");
            RenderSettingsMenu();
        });
        return;
    }
    if ($("#c-uploads #a-new").length) {
        //Upload tags will always start out blank
        Danbooru.VTI.preedittags = [];
        Danbooru.VTI.is_upload = true;
        JSPLib.storage.setStorageData('vti-was-upload',true,sessionStorage);
    } else if ($("#c-posts #a-show").length) {
        Danbooru.VTI.preedittags = GetTagList();
        JSPLib.debug.debuglog("Preedit tags:",Danbooru.VTI.preedittags);
        if (Danbooru.VTI.user_settings.implication_check_enabled) {
            QueryTagImplications(Danbooru.VTI.preedittags);
        }
        let post_id = parseInt(JSPLib.utility.getMeta('post-id'));
        let seen_post_list = JSPLib.storage.getStorageData('vti-seen-postlist',sessionStorage,[]);
        if (!Danbooru.VTI.was_upload && (!Danbooru.VTI.user_settings.single_session_warning || !seen_post_list.includes(post_id))) {
            if (Danbooru.VTI.user_settings.artist_check_enabled) {
                ValidateArtist();
            }
            if (Danbooru.VTI.user_settings.copyright_check_enabled) {
                ValidateCopyright();
            }
            if (Danbooru.VTI.user_settings.general_check_enabled) {
                ValidateGeneral();
            }
        } else {
            JSPLib.debug.debuglog("Already pre-validated post.");
        }
        JSPLib.storage.setStorageData('vti-seen-postlist',seen_post_list.concat(post_id),sessionStorage);
        JSPLib.storage.setStorageData('vti-was-upload',false,sessionStorage);
    } else if ($("#c-posts #a-index #mode-box").length){
        $(".post-preview a").click(PostModeMenuClick);
    } else {
        JSPLib.debug.debuglog("Nothing found!");
        return;
    }
    $("#form [type=submit],#quick-edit-form [type=submit][value=Submit]").after(submit_button);
    $("#form [type=submit],#quick-edit-form [type=submit][value=Submit]").hide();
    if ($("#c-posts #a-index").length) {
        $("#quick-edit-form [type=submit][value=Cancel]").after(input_validator);
        $("#quick-edit-form").after(warning_messages);
    } else{
        $("#check-tags").after(input_validator);
        $("#related-tags-container").before(warning_messages);
    }
    $("#validate-tags").click(ValidateTagsClick);
    $("#check-tags").click(CheckTagsClick);
    RebindHotkey.timer = setInterval(RebindHotkey,timer_poll_interval);
    JSPLib.debug.debugExecute(()=>{
        window.addEventListener('beforeunload',function () {
            JSPLib.statistics.outputAdjustedMean("ValidateTagInput");
        });
    });
    setTimeout(()=>{
        JSPLib.storage.pruneEntries('vti',program_cache_regex,prune_expires);
    },JSPLib.utility.one_minute);
}

//Execution start

JSPLib.load.programInitialize(main,'VTI',program_load_required_variables,program_load_required_selectors);
