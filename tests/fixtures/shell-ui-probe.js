// Test-only instrumentation appended to an isolated installed COPY, never the ZIP.
import Shell from 'gi://Shell';
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
            const actor = extension.indicator.button.menu.actor;
            const [x, y] = actor.get_transformed_position();
            const bars = [], text = [];
            const walk = item => {
                if (item.mapped) {
                    if (typeof item.get_text === 'function') text.push(item.get_text());
                    if (item.has_style_class_name?.('usagescope-fill'))
                        bars.push({width:item.width, x:item.x, track:item.get_parent().width, style:item.style_class});
                }
                for (const child of item.get_children()) walk(child);
            };
            walk(actor);
            const report = {x,y,width:actor.width,height:actor.height,stageHeight:global.stage.height,bars,text};
            const save = () => Gio.File.new_for_path(reportPath).replace_contents(
                new TextEncoder().encode(JSON.stringify(report)),null,false,Gio.FileCreateFlags.PRIVATE,null);
            if (capturePath) {
                const screenshot = new Shell.Screenshot();
                const output = Gio.File.new_for_path(capturePath).replace(null,false,Gio.FileCreateFlags.PRIVATE,null);
                screenshot.screenshot_area(Math.floor(x),Math.floor(y),Math.ceil(actor.width),Math.ceil(actor.height),output,(_object,result)=>{
                    try { screenshot.screenshot_area_finish(result); report.capture=true; }
                    catch { report.capture=false; }
                    finally { output.close(null); save(); }
                });
            } else save();
            return GLib.SOURCE_REMOVE;
        });
        return GLib.SOURCE_REMOVE;
    });
};
