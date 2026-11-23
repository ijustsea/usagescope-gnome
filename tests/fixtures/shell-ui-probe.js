// Test-only instrumentation appended to an isolated installed COPY, never the ZIP.
import Shell from 'gi://Shell';
import St from 'gi://St';
const probeEnable = UsageScopeExtension.prototype.enable;
UsageScopeExtension.prototype.enable = function () {
    probeEnable.call(this);
    const extension = this;
    const reportPath = GLib.getenv('USAGESCOPE_UI_REPORT');
    const capturePath = GLib.getenv('USAGESCOPE_UI_CAPTURE');
    if (!reportPath) return;
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
        Main.overview.hide();
        extension.indicator.button.menu.open();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {
          void (async () => {
            const actor = extension.indicator.button.menu.actor;
            const [x, y] = actor.get_transformed_position();
            const bars = [], text = [], plans = [];
            const walk = item => {
                if (item.mapped) {
                    if (typeof item.get_text === 'function') text.push(item.get_text());
                    if (item.has_style_class_name?.('usagescope-plan')) plans.push(item.get_text());
                    if (item.has_style_class_name?.('usagescope-fill')) {
                        const color = item.get_theme_node().get_background_color();
                        bars.push({width:item.width,height:item.height,x:item.x,track:item.get_parent().width,
                            trackHeight:item.get_parent().height,style:item.style_class,
                            color:{red:color.red,green:color.green,blue:color.blue,alpha:color.alpha}});
                    }
                }
                for (const child of item.get_children()) walk(child);
            };
            walk(actor);
            const report = {x,y,width:actor.width,height:actor.height,stageHeight:global.stage.height,
                bars:bars.map(bar=>({...bar})),text:[...text],plans:[...plans]};
            const pause = milliseconds => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT,milliseconds,()=>{resolve();return GLib.SOURCE_REMOVE;}));
            extension.indicator.button.menu.close();
            await pause(400);
            extension.views.codex.snapshot.windows[0].usedPercent = 0;
            extension.views.codex.snapshot.windows[1].usedPercent = 38;
            extension.render();
            await pause(100);
            extension.indicator.button.menu.open();
            await pause(600);
            bars.length = 0; text.length = 0;
            walk(actor);
            report.reopened = bars.map(bar => ({...bar}));
            const settings = extension.indicator.button.menu._getMenuItems().find(item=>item.label?.text==='설정');
            settings.menu.open();
            await pause(300);
            text.length=0;bars.length=0;walk(actor);
            const [settingsX,settingsY]=actor.get_transformed_position();
            report.settings={text:[...text],height:actor.height,y:settingsY,width:actor.width,
                pollSeconds:extension.settings.get_int('poll-seconds')};
            report.settings.controls=[];
            const controls=item=>{
                const title=typeof item.get_text==='function'?item.get_text().replace(/ [▸▾]$/u,''):'';
                if(item.mapped&&['Refresh','15초','1시간'].includes(title)){
                    const [,controlY]=item.get_transformed_position();
                    if(!report.settings.controls.some(control=>control.text===title))
                        report.settings.controls.push({text:title,y:controlY,height:item.height});
                }
                for(const child of item.get_children())controls(child);
            };
            controls(actor);
            const settingsCapture=GLib.getenv('USAGESCOPE_UI_SETTINGS_CAPTURE');
            if(settingsCapture)await new Promise(resolve=>{
                const screenshot=new Shell.Screenshot();
                const output=Gio.File.new_for_path(settingsCapture).replace(null,false,Gio.FileCreateFlags.PRIVATE,null);
                screenshot.screenshot_area(Math.floor(settingsX),Math.floor(settingsY),Math.ceil(actor.width),Math.ceil(actor.height),output,(_object,result)=>{
                    try{screenshot.screenshot_area_finish(result);}finally{output.close(null);resolve();}
                });
            });
            settings.menu.close();await pause(300);
            for(let i=0;i<100&&!(extension.views.claude.status==='ready'&&extension.views.claude.snapshot?.planType==='team');i++)await pause(50);
            report.cli={status:extension.views.claude.status,plan:extension.views.claude.snapshot?.planType,
                windows:extension.views.claude.snapshot?.windows.length,
                independentSource:extension.views.claude.snapshot?.sourceId.startsWith('claude-cli-')};
            extension.indicator.button.menu.open();await pause(300);
            bars.length=0;text.length=0;walk(actor);report.cli.bars=bars.map(bar=>({...bar}));
            settings.menu.open();await pause(300);
            const intervals=extension.indicator.intervals;
            const fast=intervals.get(15),standard=intervals.get(60);
            if(!fast||!standard)throw Error('Interval choices missing');
            const choices=[...intervals.values()].map(choice=>choice.label);
            const defaultChecked=standard.checked&&[...intervals.values()].filter(choice=>choice.checked).length===1;
            fast.grab_key_focus();
            const focusColor=fast.get_theme_node().get_border_color(St.Side.TOP);
            const focus={owned:global.stage.get_key_focus()===fast,alpha:focusColor.alpha};
            const visible=item=>{
                if(!item?.mapped)return false;
                const [,rowY]=item.get_transformed_position(),[,top]=actor.get_transformed_position();
                return rowY>=top&&rowY+item.height<=top+actor.height;
            };
            const fastVisible=[...intervals.values()].every(visible);
            const adjustment=extension.indicator.scroll.vadjustment;
            const expanded={upper:adjustment.upper,page:adjustment.page_size,stageHeight:global.stage.height};
            const previousCodex=extension.codex,previousClaude=extension.claude;
            fast.emit('clicked',1);
            // Read before any reopen below, so a click that closed Settings is caught.
            const stillOpen=settings.menu.isOpen&&extension.indicator.button.menu.isOpen;
            for(let i=0;i<100&&!(extension.codex!==previousCodex&&extension.claude!==previousClaude&&extension.views.codex.status==='ready'&&extension.views.claude.status==='ready');i++)await pause(50);
            extension.indicator.button.menu.open();settings.menu.open();await pause(300);
            report.fast={choices,visible:fastVisible,expanded,focus,defaultChecked,pollSeconds:extension.settings.get_int('poll-seconds'),
                checked:[...intervals.values()].filter(choice=>choice.checked).map(choice=>choice.label),
                stillOpen,
                controllersReplaced:extension.codex!==previousCodex&&extension.claude!==previousClaude};
            settings.menu.close();await pause(300);
            bars.length=0;text.length=0;plans.length=0;walk(actor);report.fast.plans=[...plans];
            const save = () => Gio.File.new_for_path(reportPath).replace_contents(
                new TextEncoder().encode(JSON.stringify(report)),null,false,Gio.FileCreateFlags.PRIVATE,null);
            if (capturePath) {
                const screenshot = new Shell.Screenshot();
                const output = Gio.File.new_for_path(capturePath).replace(null,false,Gio.FileCreateFlags.PRIVATE,null);
                const [captureX,captureY]=actor.get_transformed_position();
                screenshot.screenshot_area(Math.floor(captureX),Math.floor(captureY),Math.ceil(actor.width),Math.ceil(actor.height),output,(_object,result)=>{
                    try { screenshot.screenshot_area_finish(result); report.capture=true; }
                    catch { report.capture=false; }
                    finally { output.close(null); save(); }
                });
            } else save();
          })().catch(error=>logError(error));
            return GLib.SOURCE_REMOVE;
        });
        return GLib.SOURCE_REMOVE;
    });
};
