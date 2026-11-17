import test from 'node:test';
import assert from 'node:assert/strict';
import {isSelected,selectionState,setSelection} from '../public/tools/file-selection.js';
test('folder selection inherits, excludes descendants, restores subfolders and preserves unrelated choices',()=>{
 let rules=[{path:'/root',selected:true}];assert.equal(isSelected(rules,'/root/nested/file'),true);assert.equal(isSelected(rules,'/root2/file'),false);
 rules=setSelection(rules,'/root/nested',false);assert.equal(isSelected(rules,'/root/nested/file'),false);assert.equal(selectionState(rules,'/root').indeterminate,true);
 rules=setSelection(rules,'/root/nested/one.txt',true);assert.equal(isSelected(rules,'/root/nested/one.txt'),true);assert.equal(isSelected(rules,'/root/nested/two.txt'),false);assert.equal(selectionState(rules,'/root/nested').indeterminate,true);
 rules=setSelection(rules,'/root/nested',true);assert.equal(rules.length,2);assert.equal(isSelected(rules,'/root/nested/two.txt'),true);assert.equal(selectionState(rules,'/root').indeterminate,false);
 rules=setSelection(rules,'/root',false);assert.deepEqual(rules,[{path:'/root',selected:false}]);assert.equal(isSelected(rules,'/root/one'),false);
 assert.equal(isSelected([{path:'/',selected:true}],'/folder/file'),true);
});
