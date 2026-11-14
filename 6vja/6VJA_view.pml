reinitialize
load 6VJA_auth_chains.pdb, complex
bg_color white
hide everything
show cartoon, polymer.protein
set cartoon_fancy_helices, 1
set cartoon_smooth_loops, 1
set_color cd20_blue, [0.22, 0.49, 0.69]
set_color cd20_light, [0.49, 0.71, 0.85]
set_color fab1_heavy, [0.91, 0.43, 0.15]
set_color fab1_light, [0.97, 0.70, 0.29]
set_color fab2_heavy, [0.53, 0.35, 0.73]
set_color fab2_light, [0.75, 0.63, 0.86]
color cd20_blue, chain C
color cd20_light, chain D
color fab1_heavy, chain H
color fab1_light, chain L
color fab2_heavy, chain I
color fab2_light, chain M
select CD20, chain C+D and polymer.protein
select Fab_1, chain H+L and polymer.protein
select Fab_2, chain I+M and polymer.protein
select Y01_ligands, resn Y01
show sticks, Y01_ligands
color forest, Y01_ligands
set stick_radius, 0.14
deselect
orient polymer.protein
zoom polymer.protein, 6
set ray_opaque_background, 1
set ray_shadows, 0
set antialias, 2
set max_threads, 4
